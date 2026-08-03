import { describe, expect, it, vi } from 'vitest'
import { withTimeout } from '../src/runtime/utils'

/**
 * `withTimeout` abandons the work it races; it does not cancel it.
 *
 * That is fine for an ordinary tool — nothing is left holding anything — but it
 * matters for a tool flagged `awaitsHumanInput`, whose promise is a QUEUED
 * QUESTION somebody is looking at. When the ~5-minute human-input budget expires,
 * the run gives up and moves on while the question stays on screen, waiting for an
 * answer nothing will ever read (issue #498).
 *
 * The cleanup for that lives in the browser, where the queue is: `chat-store`
 * settles the finished conversation's prompts in `sendPrompt`'s `finally` (see
 * `app-browser/tests/human-prompt-production-wiring.test.ts`). This suite pins the
 * property that cleanup exists BECAUSE of, on the side that owns it — so if
 * `withTimeout` ever gains real cancellation, the change is noticed here rather
 * than leaving dead cleanup code in another package.
 */
describe('withTimeout', () => {
  it('rejects on the budget while leaving the raced promise pending', async () => {
    vi.useFakeTimers()
    try {
      let settled = false
      // Never resolves on its own — exactly like a human prompt nobody answers.
      const pending = new Promise<string>(() => undefined).finally(() => {
        settled = true
      })
      pending.catch(() => undefined)

      const raced = withTimeout(pending, 1_000, 'timed out')
      const rejection = expect(raced).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(1_001)
      await rejection

      // The abandoned promise is untouched: not resolved, not rejected, not
      // cancelled. Whoever queued it is still holding it.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(settled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves normally and clears its timer when the work wins the race', async () => {
    vi.useFakeTimers()
    try {
      await expect(withTimeout(Promise.resolve('done'), 1_000, 'timed out')).resolves.toBe('done')
      // No pending timer is left behind to fire into a finished run.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
