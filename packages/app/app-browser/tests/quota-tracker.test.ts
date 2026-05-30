import { describe, expect, it } from 'vitest'
import { RateLimitQuota } from '../src/runtime/quota-tracker.js'

const makeHeaders = (overrides: Record<string, string> = {}): Headers => {
  const defaults: Record<string, string> = {
    'x-ratelimit-limit-requests': '20000',
    'x-ratelimit-remaining-requests': '19999',
    'x-ratelimit-reset-requests': '0',
    'x-ratelimit-renewalperiod-requests': '60',
    'x-ratelimit-limit-tokens': '2000000',
    'x-ratelimit-remaining-tokens': '1999990',
    'x-ratelimit-reset-tokens': '0',
    'x-ratelimit-renewalperiod-tokens': '60',
    'x-ratelimit-abusepenalty-active': 'False',
  }
  return new Headers({ ...defaults, ...overrides })
}

describe('RateLimitQuota', () => {
  it('allows requests when quota is healthy', () => {
    const quota = new RateLimitQuota()
    quota.updateFromHeaders(makeHeaders())
    const result = quota.checkThrottle(1000)
    expect(result.shouldThrottle).toBe(false)
    expect(result.reason).toBe('none')
  })

  it('allows requests before any headers are set (first request)', () => {
    const quota = new RateLimitQuota()
    const result = quota.checkThrottle()
    expect(result.shouldThrottle).toBe(false)
    expect(result.reason).toBe('none')
  })

  it('hard-blocks when request quota is exhausted', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    quota.updateFromHeaders(
      makeHeaders({
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': '45',
      }),
      nowMs
    )
    const result = quota.checkThrottle(0, nowMs)
    expect(result.shouldThrottle).toBe(true)
    expect(result.reason).toBe('request_quota')
    // Wait time should be ~45s (plus jitter, so > 44s)
    expect(result.waitMs).toBeGreaterThan(44_000)
  })

  it('soft-throttles when request quota is below 5% threshold', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    // 5% of 20000 = 1000; remaining = 500 means we're at 2.5% — below threshold
    quota.updateFromHeaders(
      makeHeaders({
        'x-ratelimit-remaining-requests': '500',
        'x-ratelimit-reset-requests': '30',
      }),
      nowMs
    )
    const result = quota.checkThrottle(0, nowMs)
    expect(result.shouldThrottle).toBe(true)
    expect(result.reason).toBe('request_quota')
    // Soft throttle: wait should be small (< 1s + jitter)
    expect(result.waitMs).toBeLessThan(1000)
  })

  it('hard-blocks when token quota cannot fit the estimated request', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    quota.updateFromHeaders(
      makeHeaders({
        'x-ratelimit-remaining-tokens': '500',
        'x-ratelimit-reset-tokens': '20',
      }),
      nowMs
    )
    // Estimated 1000 tokens, only 500 remaining
    const result = quota.checkThrottle(1000, nowMs)
    expect(result.shouldThrottle).toBe(true)
    expect(result.reason).toBe('token_quota')
    expect(result.waitMs).toBeGreaterThan(19_000)
  })

  it('allows requests when estimated tokens fit within quota', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    // 1500000 remaining = 75% of 2000000, well above the 5% soft-throttle threshold
    quota.updateFromHeaders(
      makeHeaders({ 'x-ratelimit-remaining-tokens': '1500000' }),
      nowMs
    )
    const result = quota.checkThrottle(500, nowMs)
    expect(result.shouldThrottle).toBe(false)
  })

  it('blocks with abuse penalty when abuse flag is active', () => {
    const quota = new RateLimitQuota()
    quota.updateFromHeaders(makeHeaders({ 'x-ratelimit-abusepenalty-active': 'True' }))
    const result = quota.checkThrottle()
    expect(result.shouldThrottle).toBe(true)
    expect(result.reason).toBe('abuse_penalty')
    expect(result.waitMs).toBeGreaterThan(5000)
  })

  it('applies heuristic backoff after a recorded 429 when no headers present', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    quota.recordRateLimit(30_000, nowMs)
    const result = quota.checkThrottle(0, nowMs)
    expect(result.shouldThrottle).toBe(true)
    expect(result.reason).toBe('heuristic')
    // Should be at least the recorded backoff (amplified by 1.1)
    expect(result.waitMs).toBeGreaterThan(30_000)
  })

  it('clears heuristic backoff via clearHeuristicBackoff() after a confirmed successful response', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    quota.recordRateLimit(30_000, nowMs)
    quota.updateFromHeaders(makeHeaders())
    // updateFromHeaders no longer clears heuristic — caller must do so explicitly after 200 OK
    expect(quota.checkThrottle(0, nowMs).shouldThrottle).toBe(true)
    quota.clearHeuristicBackoff()
    expect(quota.checkThrottle(0, nowMs).shouldThrottle).toBe(false)
  })

  it('preserves heuristic backoff when updateFromHeaders is called on a non-success response', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    quota.recordRateLimit(30_000, nowMs)
    // Simulate headers arriving on a 429 — heuristic must not be cleared
    quota.updateFromHeaders(makeHeaders())
    const result = quota.checkThrottle(0, nowMs)
    expect(result.shouldThrottle).toBe(true)
    expect(result.reason).toBe('heuristic')
  })

  it('ignores stale quota windows (window already expired)', () => {
    const quota = new RateLimitQuota()
    // nowMs for update is 90 seconds ago; window was 60s — expired
    const pastMs = Date.now() - 90_000
    quota.updateFromHeaders(
      makeHeaders({
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': '10',
      }),
      pastMs
    )
    // Check at current time — window has expired, should not throttle
    const result = quota.checkThrottle(0, Date.now())
    expect(result.shouldThrottle).toBe(false)
  })

  it('interprets x-ratelimit-reset-* as absolute epoch seconds when value > 86400', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    // Simulate GitHub sending an absolute epoch timestamp ~60s in the future
    const absoluteResetSec = Math.floor((nowMs + 60_000) / 1000)
    quota.updateFromHeaders(
      makeHeaders({
        'x-ratelimit-remaining-requests': '0',
        'x-ratelimit-reset-requests': String(absoluteResetSec),
      }),
      nowMs
    )
    const result = quota.checkThrottle(0, nowMs)
    expect(result.shouldThrottle).toBe(true)
    expect(result.reason).toBe('request_quota')
    // resetAt should be close to the absolute timestamp, not nowMs + absoluteResetSec * 1000
    expect(result.waitMs).toBeGreaterThan(50_000)
    expect(result.waitMs).toBeLessThan(70_000)
  })

  it('does not throttle based on token quota when estimatedTokens is 0', () => {
    const quota = new RateLimitQuota()
    const nowMs = Date.now()
    // Even with 0 tokens remaining, no throttle if estimatedTokens is 0
    quota.updateFromHeaders(
      makeHeaders({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '30' }),
      nowMs
    )
    const result = quota.checkThrottle(0, nowMs)
    // Only request quota matters here; requests still healthy
    expect(result.shouldThrottle).toBe(false)
  })
})
