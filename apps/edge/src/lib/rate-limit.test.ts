import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  clearBackoff,
  clearModelsBackoff,
  deriveCredentialKey,
  getActiveBackoffMs,
  getModelsBackoffMs,
  parseRetryAfterMs,
  rateLimitResponseFromMs,
  recordBackoff,
  recordModelsBackoff,
  SHARED_CREDENTIAL_KEY,
  toRateLimitResponse
} from './rate-limit.js'

describe('parseRetryAfterMs', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns undefined for null or empty input', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined()
    expect(parseRetryAfterMs(undefined)).toBeUndefined()
    expect(parseRetryAfterMs('')).toBeUndefined()
    expect(parseRetryAfterMs('  ')).toBeUndefined()
  })

  it('converts a numeric seconds string to milliseconds', () => {
    expect(parseRetryAfterMs('60')).toBe(60_000)
    expect(parseRetryAfterMs('0')).toBe(0)
    expect(parseRetryAfterMs('1.5')).toBe(1500)
  })

  it('rounds fractional seconds up', () => {
    expect(parseRetryAfterMs('0.1')).toBe(100)
    expect(parseRetryAfterMs('1.001')).toBe(1001)
  })

  it('converts an HTTP-date string to milliseconds from now', () => {
    const nowMs = 1_000_000
    vi.spyOn(Date, 'now').mockReturnValue(nowMs)
    const futureDate = new Date(nowMs + 30_000).toUTCString()
    expect(parseRetryAfterMs(futureDate, nowMs)).toBe(30_000)
  })

  it('returns 0 for a past HTTP-date', () => {
    const nowMs = 1_000_000
    const pastDate = new Date(nowMs - 5_000).toUTCString()
    expect(parseRetryAfterMs(pastDate, nowMs)).toBe(0)
  })

  it('returns undefined for an unrecognised string', () => {
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined()
  })
})

describe('toRateLimitResponse', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a valid rate-limit payload with a static client-facing error message', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))

    const result = toRateLimitResponse('', '60')

    expect(result.code).toBe('rate_limited')
    expect(result.error).toBe('LiteLLM rate limit reached')
    expect(result.retryAfterMs).toBe(60_000)
    expect(result.retryAt).toBe(new Date(Date.now() + 60_000).toISOString())
  })

  it('uses the default retry delay when retry-after is absent', () => {
    const result = toRateLimitResponse('', null)
    expect(result.retryAfterMs).toBe(60_000)
  })

  it('uses the provided retry-after seconds', () => {
    const result = toRateLimitResponse('upstream body text', '120')
    expect(result.retryAfterMs).toBe(120_000)
  })

  it('does not leak the raw upstream body in the response', () => {
    const result = toRateLimitResponse('sensitive upstream error details', '30')
    expect(JSON.stringify(result)).not.toContain('sensitive upstream error details')
  })
})

describe('models backoff window', () => {
  afterEach(() => {
    clearModelsBackoff()
    vi.useRealTimers()
  })

  it('reports no backoff before any rate limit is recorded', () => {
    clearModelsBackoff()
    expect(getModelsBackoffMs()).toBe(0)
  })

  it('remembers an upstream retry window and decays as time passes', () => {
    const nowMs = 1_000_000
    recordModelsBackoff(60_000, nowMs)
    expect(getModelsBackoffMs(nowMs)).toBe(60_000)
    expect(getModelsBackoffMs(nowMs + 40_000)).toBe(20_000)
    // Once the window elapses it reports zero rather than a negative value.
    expect(getModelsBackoffMs(nowMs + 60_001)).toBe(0)
  })

  it('extends but never shortens the active window', () => {
    const nowMs = 1_000_000
    recordModelsBackoff(60_000, nowMs)
    recordModelsBackoff(10_000, nowMs)
    expect(getModelsBackoffMs(nowMs)).toBe(60_000)
  })

  it('clears the window after a successful upstream response', () => {
    const nowMs = 1_000_000
    recordModelsBackoff(60_000, nowMs)
    clearModelsBackoff()
    expect(getModelsBackoffMs(nowMs)).toBe(0)
  })

  it('builds a rate-limit payload from a remaining delay', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    const result = rateLimitResponseFromMs(45_000)
    expect(result.code).toBe('rate_limited')
    expect(result.retryAfterMs).toBe(45_000)
    expect(result.retryAt).toBe(new Date(Date.now() + 45_000).toISOString())
  })
})

describe('deriveCredentialKey', () => {
  it('falls back to the shared bucket when no credential is present', async () => {
    expect(await deriveCredentialKey(null)).toBe(SHARED_CREDENTIAL_KEY)
    expect(await deriveCredentialKey(undefined)).toBe(SHARED_CREDENTIAL_KEY)
    expect(await deriveCredentialKey('')).toBe(SHARED_CREDENTIAL_KEY)
  })

  it('derives a stable, non-reversible key per credential', async () => {
    const key = await deriveCredentialKey('Bearer token-a')
    expect(key).toBe(await deriveCredentialKey('Bearer token-a'))
    // The raw token never appears in the key.
    expect(key).not.toContain('token-a')
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it('derives distinct keys for distinct credentials', async () => {
    expect(await deriveCredentialKey('Bearer token-a')).not.toBe(
      await deriveCredentialKey('Bearer token-b')
    )
  })
})

describe('credential-scoped backoff window (issue #146)', () => {
  afterEach(() => {
    clearModelsBackoff()
  })

  it('keeps one credential’s backoff from affecting another', () => {
    const nowMs = 3_000_000
    // Credential keys are derived from the shared LiteLLM key + base URL, so
    // distinct allowlisted deployments land in distinct buckets.
    recordModelsBackoff(60_000, nowMs, 'cred-a')

    // The credential that hit the limit is backed off...
    expect(getModelsBackoffMs(nowMs, 'cred-a')).toBe(60_000)
    // ...but a different credential (e.g. another base URL) is not.
    expect(getModelsBackoffMs(nowMs, 'cred-b')).toBe(0)
  })

  it('clears only the targeted credential scope', () => {
    const nowMs = 3_000_000
    recordModelsBackoff(60_000, nowMs, 'cred-a')
    recordModelsBackoff(60_000, nowMs, 'cred-b')

    clearModelsBackoff('cred-a')

    expect(getModelsBackoffMs(nowMs, 'cred-a')).toBe(0)
    expect(getModelsBackoffMs(nowMs, 'cred-b')).toBe(60_000)
  })
})

describe('durable backoff window', () => {
  // Outside Cloudflare `caches.default` is absent, so the durable layer degrades
  // to the in-memory mirror — the request path (getActiveBackoffMs/recordBackoff/
  // clearBackoff) must still honour and clear the window.
  afterEach(async () => {
    await clearBackoff()
    vi.useRealTimers()
  })

  it('reports an active window recorded via recordBackoff', async () => {
    const nowMs = 2_000_000
    await recordBackoff(60_000, nowMs)
    expect(await getActiveBackoffMs(nowMs)).toBe(60_000)
    expect(await getActiveBackoffMs(nowMs + 60_001)).toBe(0)
  })

  it('clears the window after a successful upstream response', async () => {
    const nowMs = 2_000_000
    await recordBackoff(60_000, nowMs)
    await clearBackoff()
    expect(await getActiveBackoffMs(nowMs)).toBe(0)
  })
})
