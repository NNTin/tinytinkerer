import type { PreferencesStore } from '@tinytinkerer/app-core'
import { getOrCreateInstallId } from './install-id'

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
type TelemetryLevel = 'warning' | 'error'

// Removes the query string from a URL so breadcrumbs/events never carry
// request payloads encoded as query params. Falls back to the raw value when
// the input is not a parseable URL.
const stripUrlQuery = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }
  const queryIndex = value.indexOf('?')
  return queryIndex === -1 ? value : value.slice(0, queryIndex)
}

type TelemetryConfig = {
  dsn?: string
  appVersion: string
  buildHash: string
}

type TelemetryCaptureOptions = {
  level?: TelemetryLevel
  tags?: Record<string, string | number | boolean | undefined>
  contexts?: Record<string, Record<string, unknown>>
}

// Module singleton: the browser apps are single-instance SPAs, so a shared
// telemetry state avoids threading an instance through every fetch call site.
let config: TelemetryConfig = { appVersion: 'dev', buildHash: 'dev' }
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

const ensureSentry = async (): Promise<void> => {
  if (sentry || !config.dsn) {
    return
  }
  // Lazy import keeps @sentry/react out of the main bundle until consent.
  sentryInitPromise ??= import('@sentry/react')
    .then((mod) => {
      mod.init({
        dsn: config.dsn,
        release: config.buildHash,
        // Errors only — no performance tracing, no session replay. Keep the
        // browser SDK on a minimal integration set so uncaught exceptions and
        // unhandled rejections are reported without turning on the broader
        // default browser instrumentation.
        defaultIntegrations: false,
        integrations: [mod.globalHandlersIntegration()],
        tracesSampleRate: 0,
        // Never collect user-typed content. We keep the auto-detected IP
        // (disclosed in PRIVACY.md) but strip request bodies and the console
        // logs / network payloads that breadcrumbs would otherwise capture.
        sendDefaultPii: false,
        beforeBreadcrumb: (breadcrumb) => {
          if (breadcrumb.category === 'console') {
            return null
          }
          if (
            (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') &&
            breadcrumb.data
          ) {
            breadcrumb.data.url = stripUrlQuery(breadcrumb.data.url)
          }
          return breadcrumb
        },
        beforeSend: (event) => {
          if (event.request) {
            delete event.request.data
            delete event.request.query_string
            if (typeof event.request.url === 'string') {
              event.request.url = stripUrlQuery(event.request.url) as string
            }
          }
          return event
        }
      })
      sentry = mod
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

export const captureTelemetryException = (
  error: unknown,
  options: TelemetryCaptureOptions = {}
): void => {
  if (!sentry) {
    return
  }

  const normalizedError =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown telemetry error')

  sentry.withScope((scope) => {
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
    sentry?.captureException(normalizedError)
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
