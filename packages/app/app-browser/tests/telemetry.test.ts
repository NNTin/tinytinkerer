import { beforeEach, describe, expect, it, vi } from 'vitest'

// Spy on @sentry/react's init so we can assert whether telemetry actually
// boots per environment. The module is lazily imported inside ensureSentry.
const init = vi.hoisted(() => vi.fn())
const close = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const setUser = vi.hoisted(() => vi.fn())
const captureException = vi.hoisted(() => vi.fn())
const captureMessage = vi.hoisted(() => vi.fn())
// withScope runs its callback synchronously with a minimal scope stub so the
// dispatchers' scope mutations and capture calls actually execute under test.
const withScope = vi.hoisted(() =>
  vi.fn((cb: (scope: unknown) => void) =>
    cb({ setLevel: vi.fn(), setTag: vi.fn(), setContext: vi.fn(), setFingerprint: vi.fn() })
  )
)

vi.mock('@sentry/react', () => ({
  init,
  close,
  setUser,
  withScope,
  captureException,
  captureMessage
}))

vi.mock('../src/telemetry/install-id.js', () => ({
  getOrCreateInstallId: vi.fn().mockResolvedValue('install-1')
}))

const preferences = {} as never

const loadTelemetry = async () => {
  vi.resetModules()
  init.mockClear()
  return import('../src/telemetry/telemetry.js')
}

describe('telemetry environment gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not initialize Sentry for the development (localhost) environment', async () => {
    const telemetry = await loadTelemetry()
    await telemetry.configureTelemetry(
      { dsn: 'https://dsn@sentry.io/1', environment: 'development', appVersion: 'dev', buildHash: 'dev' },
      preferences
    )
    await telemetry.setTelemetryConsent(true)
    expect(init).not.toHaveBeenCalled()
  })

  it('initializes Sentry for the production environment when consent is granted', async () => {
    const telemetry = await loadTelemetry()
    await telemetry.configureTelemetry(
      { dsn: 'https://dsn@sentry.io/1', environment: 'production', appVersion: '1.0.0', buildHash: 'abc1234' },
      preferences
    )
    await telemetry.setTelemetryConsent(true)
    expect(init).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ environment: 'production' }))
  })

  it('still skips init for development even with consent and a DSN present', async () => {
    const telemetry = await loadTelemetry()
    // Consent first, then configure — exercises the other ordering too.
    await telemetry.setTelemetryConsent(true)
    await telemetry.configureTelemetry(
      { dsn: 'https://dsn@sentry.io/1', environment: 'development', appVersion: 'dev', buildHash: 'dev' },
      preferences
    )
    expect(init).not.toHaveBeenCalled()
  })
})

describe('telemetry message capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const enableTelemetry = async () => {
    const telemetry = await loadTelemetry()
    await telemetry.configureTelemetry(
      { dsn: 'https://dsn@sentry.io/1', environment: 'production', appVersion: '1.0.0', buildHash: 'abc1234' },
      preferences
    )
    await telemetry.setTelemetryConsent(true)
    return telemetry
  }

  it('routes captureTelemetryMessage through Sentry captureMessage, not captureException', async () => {
    const telemetry = await enableTelemetry()

    telemetry.captureTelemetryMessage('Feedback (idea): add dark mode', { level: 'info' })

    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith('Feedback (idea): add dark mode')
    expect(captureException).not.toHaveBeenCalled()
  })

  it('still routes captureTelemetryException through Sentry captureException', async () => {
    const telemetry = await enableTelemetry()

    telemetry.captureTelemetryException(new Error('boom'), { level: 'error' })

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureMessage).not.toHaveBeenCalled()
  })
})
