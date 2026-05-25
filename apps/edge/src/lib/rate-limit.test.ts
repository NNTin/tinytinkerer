import { describe, expect, it, vi, afterEach } from 'vitest'
import { parseRetryAfterMs, toRateLimitResponse } from './rate-limit.js'

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
    expect(result.error).toBe('GitHub Models rate limit reached')
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
