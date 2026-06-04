import type { PreferencesStore } from '@tinytinkerer/app-core'
import {
  scrubBreadcrumb,
  scrubEvent,
  setCaptureExceptionSink,
  setCaptureMessageSink,
  type TelemetryCaptureOptions
} from '@tinytinkerer/sentry-telemetry'
import type { Scope } from '@sentry/react'
import { getOrCreateInstallId } from './install-id'

// Re-exported so existing `./telemetry` importers keep a stable path; the
// implementation (and the request-telemetry engine) now lives in the shared
// @tinytinkerer/sentry-telemetry package. See docs/sentry-telemetry.md.
export { captureTelemetryException, captureTelemetryMessage } from '@tinytinkerer/sentry-telemetry'

// Wire-protocol header names. Mirrors TELEMETRY_HEADERS in @tinytinkerer/contracts
// (consumed by the edge). Inlined here to keep the eager client bundle free of the
// contracts/zod barrel.
const TELEMETRY_HEADERS = {
  appVersion: 'X-App-Version',
  buildHash: 'X-Build-Hash',
  installId: 'X-Install-ID',
  githubId: 'X-GitHub-ID'
} as const

type SentryModule = typeof import('@sentry/react')

type TelemetryConfig = {
  dsn?: string
  environment?: string
  appVersion: string
  buildHash: string
}

// Module singleton: the browser apps are single-instance SPAs, so a shared
// telemetry state avoids threading an instance through every fetch call site.
let config: TelemetryConfig = { environment: 'development', appVersion: 'dev', buildHash: 'dev' }
let consent = false
let installId: string | null = null
let githubId: string | null = null
let sentry: SentryModule | null = null
let sentryInitPromise: Promise<void> | null = null

const applySentryUser = (): void => {
  if (!sentry) {
    return
  }
  if (installId) {
    sentry.setUser({ id: installId, ...(githubId ? { username: githubId } : {}) })
  } else {
    sentry.setUser(null)
  }
}

// Localhost (and any other non-deployed build) reports under the `development`
// environment. Those events are never production signal — they pollute the
// shared Sentry projects' triage list and burn quota — so we never initialize
// Sentry there, even if a DSN leaks into the local env and consent is granted.
// This is the "prevent the report at the source" rule applied per environment:
// deployed builds set `pr-preview` / `develop` / `production` explicitly.
const TELEMETRY_DISABLED_ENVIRONMENTS = new Set(['development'])

const isTelemetryEnvironmentEnabled = (): boolean =>
  !TELEMETRY_DISABLED_ENVIRONMENTS.has(config.environment ?? 'development')

const ensureSentry = async (): Promise<void> => {
  if (sentry || !config.dsn || !isTelemetryEnvironmentEnabled()) {
    return
  }
  // Lazy import keeps @sentry/react out of the main bundle until consent.
  sentryInitPromise ??= import('@sentry/react')
    .then((mod) => {
      mod.init({
        dsn: config.dsn,
        environment: config.environment,
        release: config.buildHash,
        // Errors only — no performance tracing, no session replay.
        integrations: [],
        tracesSampleRate: 0,
        // Never collect user-typed content. We keep the auto-detected IP
        // (disclosed in PRIVACY.md) but strip request bodies and the console
        // logs / network payloads that breadcrumbs would otherwise capture.
        sendDefaultPii: false,
        beforeBreadcrumb: scrubBreadcrumb,
        beforeSend: scrubEvent
      })
      sentry = mod
      setCaptureExceptionSink(dispatchToSentry)
      setCaptureMessageSink(dispatchMessageToSentry)
      applySentryUser()
    })
    .catch((error) => {
      sentryInitPromise = null
      // Telemetry must never break the app; swallow init failures.
      console.error('Failed to initialize telemetry', error)
    })
  await sentryInitPromise
}

/**
 * Configures telemetry metadata and loads the install ID. Safe to call once at
 * bootstrap; does not enable telemetry on its own.
 */
export const configureTelemetry = async (
  next: TelemetryConfig,
  preferences: PreferencesStore
): Promise<void> => {
  config = next
  try {
    installId = await getOrCreateInstallId(preferences)
  } catch {
    installId = null
  }
  if (consent) {
    await ensureSentry()
    applySentryUser()
  }
}

/** Enables or disables telemetry, initializing or tearing down Sentry. */
export const setTelemetryConsent = async (enabled: boolean): Promise<void> => {
  consent = enabled
  if (enabled) {
    await ensureSentry()
    applySentryUser()
    return
  }
  if (sentry) {
    setCaptureExceptionSink(null)
    setCaptureMessageSink(null)
    sentry.setUser(null)
    await sentry.close()
    sentry = null
    sentryInitPromise = null
  }
}

/** Sets the GitHub account identifier sent as the GitHub ID when signed in. */
export const setTelemetryGitHubId = (value: string | null): void => {
  githubId = value
  if (consent) {
    applySentryUser()
  }
}

// Applies the SDK-agnostic capture options (level, tags, contexts, fingerprint)
// onto a Sentry scope. Shared by the exception and message dispatchers.
const applyCaptureOptions = (scope: Scope, options: TelemetryCaptureOptions): void => {
  if (options.level) {
    scope.setLevel(options.level)
  }
  if (options.tags) {
    for (const [key, value] of Object.entries(options.tags)) {
      if (value !== undefined) {
        scope.setTag(key, String(value))
      }
    }
  }
  if (options.contexts) {
    for (const [key, value] of Object.entries(options.contexts)) {
      scope.setContext(key, value)
    }
  }
  if (options.fingerprint) {
    scope.setFingerprint(options.fingerprint)
  }
}

// Browser capture sink registered with @tinytinkerer/sentry-telemetry once the
// @sentry/react SDK is initialized. Maps the SDK-agnostic capture options onto a
// Sentry scope. The package's `captureTelemetryException` dispatches here.
const dispatchToSentry = (error: Error, options: TelemetryCaptureOptions): void => {
  if (!sentry) {
    return
  }
  sentry.withScope((scope) => {
    applyCaptureOptions(scope, options)
    sentry?.captureException(error)
  })
}

// Message sink counterpart: reports a plain message via `captureMessage` so the
// event is filed as a (typically `info`-level) message rather than an error
// issue with a synthetic stack trace. Used for non-error telemetry like feedback.
const dispatchMessageToSentry = (message: string, options: TelemetryCaptureOptions): void => {
  if (!sentry) {
    return
  }
  sentry.withScope((scope) => {
    applyCaptureOptions(scope, options)
    sentry?.captureMessage(message)
  })
}

/**
 * Headers attached to edge requests. App version and build hash are always
 * sent (non-identifying operational metadata). The install ID and GitHub ID
 * are only sent once telemetry consent has been granted.
 */
export const getTelemetryHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    [TELEMETRY_HEADERS.appVersion]: config.appVersion,
    [TELEMETRY_HEADERS.buildHash]: config.buildHash
  }
  if (consent) {
    if (installId) {
      headers[TELEMETRY_HEADERS.installId] = installId
    }
    if (githubId) {
      headers[TELEMETRY_HEADERS.githubId] = githubId
    }
  }
  return headers
}
