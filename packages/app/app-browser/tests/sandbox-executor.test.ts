// @vitest-environment jsdom
//
// The sandbox executor runs untrusted code in an iframe + Worker. jsdom cannot
// execute iframe scripts or run a real Worker, so the actual code-execution and
// the isolation guarantees (opaque origin, CSP blocking network/eval) are covered
// by manual / real-browser verification — see docs/plugin-infrastructure.md and
// the PR verification notes. What IS deterministic and security-relevant — and
// covered here — is the host-side orchestration: the untrusted-message coercion
// and size caps (`normalizeResult`), the strict message boundary (source + nonce
// + type), single-settle + teardown, the concurrency limit, and timeout clamping.
// We drive those by stubbing the iframe's `contentWindow` and dispatching crafted
// message events; a fake `Worker` is installed only so the availability guard
// passes (it is never instantiated — that happens inside the iframe).
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
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

  it('enforces a real total-size cap host-side, truncating the crossing line', () => {
    const huge = 'x'.repeat(5_000_000)
    const logs = normalizeResult({ ok: true, logs: [huge], timedOut: false }).logs
    expect(logs).toHaveLength(1)
    // ~4M chars kept + a short truncation suffix; nowhere near the original 5M.
    expect(logs[0]!.length).toBeLessThanOrEqual(4_000_000 + 32)
    expect(logs[0]!.endsWith('…[output truncated]')).toBe(true)
  })

  it('stops accumulating once the size budget is exhausted, not just the line count', () => {
    const line = 'y'.repeat(1_000_000)
    const logs = normalizeResult({
      ok: true,
      logs: [line, line, line, line, line, line],
      timedOut: false
    }).logs
    expect(logs.join('').length).toBeLessThanOrEqual(4_000_000 + 32)
  })

  it('passes result through as opaque data, including when absent', () => {
    expect('result' in normalizeResult({ ok: true, logs: [], timedOut: false })).toBe(false)
    expect(normalizeResult({ ok: true, result: null, logs: [], timedOut: false }).result).toBeNull()
  })

  it('replaces an oversized result with a structured, actionable truncation signal (FRONTEND-14/15)', () => {
    // A run_javascript that returns the full `dom` tree can be hundreds of KB.
    const huge = { blob: 'x'.repeat(200_000) }
    const result = normalizeResult({ ok: true, result: huge, logs: [], timedOut: false }).result as {
      truncated: boolean
      chars: number
      limit: number
      hint: string
      preview: string
    }
    expect(result.truncated).toBe(true)
    expect(result.chars).toBeGreaterThan(200_000)
    expect(result.limit).toBe(32_000)
    expect(result.hint).toMatch(/smaller|aggregated/i) // tells the model how to recover
    expect(result.preview.length).toBeLessThan(2_100) // a bounded preview of the shape
    // The signal itself is small enough to never re-trip the message clamp.
    expect(JSON.stringify(result).length).toBeLessThan(32_000)

    // A normal-sized result is returned unchanged (object, not wrapped).
    const small = { count: 3 }
    expect(normalizeResult({ ok: true, result: small, logs: [], timedOut: false }).result).toEqual(
      small
    )
  })
})

class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  postMessage(): void {}
  terminate(): void {}
}

// The setup message the executor posts into the iframe on load.
type SandboxPost = {
  nonce: string
  code: string
  input: unknown
  dom: unknown
  timeoutMs: number
}

const makePostMessage = () => vi.fn<(message: SandboxPost, targetOrigin: string) => void>()

type CapturedFrame = {
  iframe: HTMLIFrameElement
  win: { postMessage: ReturnType<typeof makePostMessage> }
}

// Dispatch a window 'message' event with a fully-controlled `source` and `data`
// (jsdom's MessageEvent coerces an unknown `source` to null, so we set it by hand).
const dispatchMessage = (source: unknown, data: unknown): void => {
  const event = new Event('message')
  Object.defineProperty(event, 'source', { value: source, configurable: true })
  Object.defineProperty(event, 'data', { value: data, configurable: true })
  window.dispatchEvent(event)
}

describe('createSandboxExecutor', () => {
  let captured: CapturedFrame[]
  let createElementSpy: MockInstance

  beforeEach(() => {
    vi.useFakeTimers()
    captured = []
    ;(globalThis as unknown as { Worker: unknown }).Worker = FakeWorker
    const realCreate = document.createElement.bind(document)
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag)
      if (tag === 'iframe') {
        const win = { postMessage: makePostMessage() }
        Object.defineProperty(element, 'contentWindow', { value: win, configurable: true })
        captured.push({ iframe: element as HTMLIFrameElement, win })
      }
      return element
    })
  })

  afterEach(() => {
    createElementSpy.mockRestore()
    delete (globalThis as unknown as { Worker?: unknown }).Worker
    // Fire any pending backstops so unsettled runs resolve instead of dangling.
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  // Fire the iframe's onload (which posts the code into the sandbox) and return the
  // nonce the executor generated, read back from the captured postMessage payload.
  const fireLoadAndGetNonce = (frame: CapturedFrame): string => {
    ;(frame.iframe.onload as (event: Event) => void)(new Event('load'))
    return frame.win.postMessage.mock.calls[0]![0].nonce
  }

  const postedTimeout = (frame: CapturedFrame): number =>
    frame.win.postMessage.mock.calls[0]![0].timeoutMs

  const postedDom = (frame: CapturedFrame): unknown =>
    frame.win.postMessage.mock.calls[0]![0].dom

  it('resolves with the normalized result of a message matching source + nonce + type', async () => {
    const execute = createSandboxExecutor()
    const promise = execute({ code: 'return 1' })

    expect(captured).toHaveLength(1)
    const frame = captured[0]!
    const nonce = fireLoadAndGetNonce(frame)

    dispatchMessage(frame.win, {
      nonce,
      type: 'result',
      ok: true,
      result: 5,
      logs: ['hi'],
      timedOut: false
    })

    await expect(promise).resolves.toEqual({ ok: true, result: 5, logs: ['hi'], timedOut: false })
    expect(frame.iframe.parentNode).toBeNull() // torn down
  })

  it('ignores messages from the wrong source, wrong nonce, or wrong type', async () => {
    const execute = createSandboxExecutor()
    const promise = execute({ code: 'return 1' })
    const frame = captured[0]!
    const nonce = fireLoadAndGetNonce(frame)

    // Wrong source (a different window-like object).
    dispatchMessage({}, { nonce, type: 'result', ok: true, result: 'evil', logs: [], timedOut: false })
    // Right source, wrong nonce.
    dispatchMessage(frame.win, { nonce: 'bogus', type: 'result', ok: true, result: 'evil', logs: [], timedOut: false })
    // Right source + nonce, wrong type.
    dispatchMessage(frame.win, { nonce, type: 'nope', ok: true, result: 'evil', logs: [], timedOut: false })
    // Finally a legitimate reply.
    dispatchMessage(frame.win, { nonce, type: 'result', ok: true, result: 'good', logs: [], timedOut: false })

    // If any forged message had been accepted it would have resolved 'evil' first.
    await expect(promise).resolves.toMatchObject({ result: 'good' })
  })

  it('settles exactly once and tears the iframe down once on a duplicate message', async () => {
    const execute = createSandboxExecutor()
    const promise = execute({ code: 'return 1' })
    const frame = captured[0]!
    const removeSpy = vi.spyOn(frame.iframe, 'remove')
    const nonce = fireLoadAndGetNonce(frame)

    dispatchMessage(frame.win, { nonce, type: 'result', ok: true, result: 1, logs: [], timedOut: false })
    dispatchMessage(frame.win, { nonce, type: 'result', ok: true, result: 2, logs: [], timedOut: false })

    await expect(promise).resolves.toMatchObject({ result: 1 })
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a run beyond the concurrency limit and frees the slot when one settles', async () => {
    const execute = createSandboxExecutor()

    const p1 = execute({ code: '1' })
    void execute({ code: '2' })
    void execute({ code: '3' })
    expect(captured).toHaveLength(3)

    const p4Result = await execute({ code: '4' })
    expect(p4Result).toMatchObject({ ok: false, timedOut: false })
    expect(p4Result.error).toContain('busy')
    expect(captured).toHaveLength(3) // the rejected run never built an iframe

    // Settle the first run; its slot should free up.
    const frame1 = captured[0]!
    const nonce1 = fireLoadAndGetNonce(frame1)
    dispatchMessage(frame1.win, { nonce: nonce1, type: 'result', ok: true, logs: [], timedOut: false })
    await p1

    void execute({ code: '5' })
    expect(captured).toHaveLength(4) // now admitted
  })

  it('clamps the requested timeout to the hard ceiling and floors invalid values', () => {
    const execute = createSandboxExecutor()

    void execute({ code: '1', timeoutMs: 999_999 })
    fireLoadAndGetNonce(captured[0]!)
    expect(postedTimeout(captured[0]!)).toBe(10_000)

    void execute({ code: '2', timeoutMs: 1_000 })
    fireLoadAndGetNonce(captured[1]!)
    expect(postedTimeout(captured[1]!)).toBe(1_000)

    void execute({ code: '3', timeoutMs: -5 })
    fireLoadAndGetNonce(captured[2]!)
    expect(postedTimeout(captured[2]!)).toBe(10_000)
  })

  it('injects the shared DOM snapshot into the iframe as `dom`', () => {
    const snapshot = { tag: 'html', children: [{ tag: 'body', text: 'hi' }] }
    const execute = createSandboxExecutor(() => snapshot)

    void execute({ code: 'return dom.tag' })
    fireLoadAndGetNonce(captured[0]!)

    expect(postedDom(captured[0]!)).toEqual(snapshot)
  })

  it('posts `dom: null` when no snapshot getter is wired or it returns null', () => {
    void createSandboxExecutor()({ code: 'return dom' })
    fireLoadAndGetNonce(captured[0]!)
    expect(postedDom(captured[0]!)).toBeNull()

    void createSandboxExecutor(() => null)({ code: 'return dom' })
    fireLoadAndGetNonce(captured[1]!)
    expect(postedDom(captured[1]!)).toBeNull()
  })

  it('fails closed when the host has no DOM/Worker to isolate code', async () => {
    delete (globalThis as unknown as { Worker?: unknown }).Worker
    const result = await createSandboxExecutor()({ code: 'return 1' })
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(false)
    expect(result.error).toContain('unavailable')
  })
})
