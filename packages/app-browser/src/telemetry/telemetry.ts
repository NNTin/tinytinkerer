import type { PreferencesStore } from '@tinytinkerer/app-core'
import { getOrCreateInstallId } from './install-id'

// Wire-protocol header names. Mirrors TELEMETRY_HEADERS in @tinytinkerer/contracts
// (consumed by the edge). Inlined here to keep the eager client bundle free of the
// contracts/zod barrel.
const TELEMETRY_HEADERS = {
  appVersion: 'X-App-Version',
  buildHash: 'X-Build-Hash',
  installId: 'X-Install-ID',
  licenseId: 'X-License-ID'
} as const

type SentryModule = typeof import('@sentry/react')

type TelemetryConfig = {
  dsn?: string
  appVersion: string
  buildHash: string
}

// Module singleton: the browser apps are single-instance SPAs, so a shared
// telemetry state avoids threading an instance through every fetch call site.
let config: TelemetryConfig = { appVersion: 'dev', buildHash: 'dev' }
let consent = false
let installId: string | null = null
let licenseId: string | null = null
let sentry: SentryModule | null = null
let sentryInitPromise: Promise<void> | null = null

const applySentryUser = (): void => {
  if (!sentry) {
    return
  }
  if (installId) {
    sentry.setUser({ id: installId, ...(licenseId ? { username: licenseId } : {}) })
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
        // Errors only — no performance tracing, no session replay.
        integrations: [],
        tracesSampleRate: 0
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

/** Sets the GitHub account identifier sent as the license ID when signed in. */
export const setTelemetryLicenseId = (value: string | null): void => {
  licenseId = value
  if (consent) {
    applySentryUser()
  }
}

/**
 * Headers attached to edge requests. App version and build hash are always
 * sent (non-identifying operational metadata). The install ID and license ID
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
    if (licenseId) {
      headers[TELEMETRY_HEADERS.licenseId] = licenseId
    }
  }
  return headers
}

/** Reports an exception to Sentry when telemetry is enabled; no-op otherwise. */
export const captureTelemetryException = (error: unknown): void => {
  if (consent && sentry) {
    sentry.captureException(error)
  }
}
