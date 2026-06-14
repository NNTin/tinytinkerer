// @vitest-environment node
//
// The sandbox executor runs untrusted code in an iframe + Worker. jsdom cannot
// execute iframe scripts or run real Workers, so an end-to-end execution test is
// not meaningful here — that path is covered by manual verification (see
// docs/plugin-infrastructure.md and the PR's verification notes). These tests
// cover the deterministic, security-relevant pieces: the untrusted-message
// coercion (`normalizeResult`) and graceful unavailability when no DOM/Worker is
// present (this file forces the `node` environment so `document`/`Worker` are
// absent).
import { describe, expect, it } from 'vitest'
import { createSandboxExecutor, normalizeResult } from '../src/sandbox-executor'

describe('normalizeResult', () => {
  it('coerces a well-formed success message into the contract shape', () => {
    expect(
      normalizeResult({ ok: true, result: 42, logs: ['a', 'b'], timedOut: false })
    ).toEqual({ ok: true, result: 42, logs: ['a', 'b'], timedOut: false })
  })

  it('treats anything but ok===true as a failure and coerces timedOut', () => {
    expect(normalizeResult({ ok: 'yes', logs: [], timedOut: 'no' })).toEqual({
      ok: false,
      logs: [],
      timedOut: false
    })
  })

  it('passes a string error through but drops a non-string error', () => {
    expect(normalizeResult({ ok: false, logs: [], error: 'bad' }).error).toBe('bad')
    expect('error' in normalizeResult({ ok: false, logs: [], error: { evil: true } })).toBe(false)
  })

  it('filters non-string log entries from untrusted output', () => {
    expect(
      normalizeResult({ ok: true, logs: ['ok', 42, null, { x: 1 }, 'fine'], timedOut: false }).logs
    ).toEqual(['ok', 'fine'])
  })

  it('caps the number of log lines as a backstop to the in-worker cap', () => {
    const flood = Array.from({ length: 20_000 }, (_, i) => String(i))
    expect(normalizeResult({ ok: true, logs: flood, timedOut: false }).logs).toHaveLength(10_000)
  })

  it('passes result through as opaque data, including when absent', () => {
    expect('result' in normalizeResult({ ok: true, logs: [], timedOut: false })).toBe(false)
    expect(normalizeResult({ ok: true, result: null, logs: [], timedOut: false }).result).toBeNull()
  })
})

describe('createSandboxExecutor', () => {
  it('fails closed when the host has no DOM/Worker to isolate code', async () => {
    const execute = createSandboxExecutor()
    const result = await execute({ code: 'return 1' })
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(result.error).toContain('unavailable')
  })
})
