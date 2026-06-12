import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkInboundRateLimit,
  clearInboundRateLimits
} from './inbound-rate-limit.js'
import { makeCacheMock } from '../test/cache-mock.js'

const WINDOW_MS = 60_000

describe('checkInboundRateLimit', () => {
  afterEach(() => {
    clearInboundRateLimits()
    vi.unstubAllGlobals()
  })

  it('allows requests up to the limit and rejects the next with the remaining window', async () => {
    const nowMs = 1_000_000
    for (let i = 0; i < 3; i++) {
      expect(
        await checkInboundRateLimit('auth', 'caller-a', 3, WINDOW_MS, nowMs)
      ).toEqual({ limited: false })
    }

    const limited = await checkInboundRateLimit(
      'auth',
      'caller-a',
      3,
      WINDOW_MS,
      nowMs + 10_000
    )
    expect(limited).toEqual({ limited: true, retryAfterMs: 50_000 })
  })

  it('does not extend the window for rejected requests', async () => {
    const nowMs = 1_000_000
    await checkInboundRateLimit('auth', 'caller-a', 1, WINDOW_MS, nowMs)
    // Hammering while limited must not push the reset further out.
    await checkInboundRateLimit('auth', 'caller-a', 1, WINDOW_MS, nowMs + 1_000)
    const limited = await checkInboundRateLimit(
      'auth',
      'caller-a',
      1,
      WINDOW_MS,
      nowMs + 2_000
    )
    expect(limited).toEqual({ limited: true, retryAfterMs: 58_000 })
  })

  it('opens a fresh window once the previous one elapses', async () => {
    const nowMs = 1_000_000
    await checkInboundRateLimit('auth', 'caller-a', 1, WINDOW_MS, nowMs)
    expect(
      (await checkInboundRateLimit('auth', 'caller-a', 1, WINDOW_MS, nowMs + 1))
        .limited
    ).toBe(true)
    expect(
      await checkInboundRateLimit(
        'auth',
        'caller-a',
        1,
        WINDOW_MS,
        nowMs + WINDOW_MS + 1
      )
    ).toEqual({ limited: false })
  })

  it('keeps one caller’s exhaustion from limiting another (per-key isolation)', async () => {
    const nowMs = 1_000_000
    await checkInboundRateLimit('search', 'caller-a', 1, WINDOW_MS, nowMs)
    expect(
      (await checkInboundRateLimit('search', 'caller-a', 1, WINDOW_MS, nowMs))
        .limited
    ).toBe(true)
    expect(
      await checkInboundRateLimit('search', 'caller-b', 1, WINDOW_MS, nowMs)
    ).toEqual({ limited: false })
  })

  it('keeps scopes independent for the same caller', async () => {
    const nowMs = 1_000_000
    await checkInboundRateLimit('search', 'caller-a', 1, WINDOW_MS, nowMs)
    expect(
      (await checkInboundRateLimit('search', 'caller-a', 1, WINDOW_MS, nowMs))
        .limited
    ).toBe(true)
    // Exhausting search must not consume the same caller's MCP budget.
    expect(
      await checkInboundRateLimit('mcp', 'caller-a', 1, WINDOW_MS, nowMs)
    ).toEqual({ limited: false })
  })

  it('honours counts accumulated by another isolate via the durable layer', async () => {
    const { cache } = makeCacheMock()
    vi.stubGlobal('caches', { default: cache })

    const nowMs = 1_000_000
    await checkInboundRateLimit('auth', 'caller-a', 1, WINDOW_MS, nowMs)
    // A fresh isolate starts with an empty in-memory map but the same colo cache.
    clearInboundRateLimits()
    const limited = await checkInboundRateLimit(
      'auth',
      'caller-a',
      1,
      WINDOW_MS,
      nowMs + 5_000
    )
    expect(limited).toEqual({ limited: true, retryAfterMs: 55_000 })
  })
})
