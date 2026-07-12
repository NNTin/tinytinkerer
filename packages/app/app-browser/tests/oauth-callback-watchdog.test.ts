// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'

// Backstop for the class of bug that motivated this watchdog (issue #409
// follow-up): apps/host's root composition had NO '/auth/callback' route, so a
// GitHub OAuth redirect landed on a page that never called
// completeGitHubOAuthCallback — nothing threw, nothing was captured, the user
// was just silently logged out. The watchdog is armed at boot on any URL
// carrying an OAuth code and fires a Sentry capture if nothing marks itself
// "handled" (and no token appears) within the window.
//
// A sibling module (./oauth-callback-handled) holds the `handled` singleton, so
// each test re-imports it fresh via vi.resetModules() rather than exposing a
// test-only reset export (this codebase avoids test-only exports where a plain
// re-import will do). The watchdog imports that flag module statically, so both
// resolve to the same fresh instance when re-imported after the reset. Because
// resetModules() also invalidates the already-loaded @tinytinkerer/sentry-telemetry
// instance, the sink must be (re-)registered AFTER the reset, against the same
// fresh instance the watchdog's import chain will resolve to — registering it
// against a statically-imported (pre-reset) instance would silently attach it
// to a module the watchdog never talks to.

const setUrlCode = (hasCode: boolean): void => {
  window.history.replaceState(
    null,
    '',
    hasCode ? '/#/auth/callback?code=abc123&state=xyz' : '/#/auth/callback'
  )
}

const sink = vi.fn<CaptureExceptionSink>()

const loadWatchdog = async () => {
  vi.resetModules()
  const { setCaptureExceptionSink } = await import('@tinytinkerer/sentry-telemetry')
  setCaptureExceptionSink(sink)
  const watchdog = await import('../src/telemetry/oauth-callback-watchdog.js')
  // markOAuthCallbackHandled moved to the sibling flag module the watchdog reads;
  // import it in the SAME post-reset cycle so it flips the very `handled` singleton
  // this freshly-loaded watchdog checks.
  const { markOAuthCallbackHandled } = await import('../src/telemetry/oauth-callback-handled.js')
  return { ...watchdog, markOAuthCallbackHandled }
}

beforeEach(() => {
  sink.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('armOAuthCallbackWatchdog', () => {
  it('captures an unhandled callback after 10s when a code is present and no token appears', async () => {
    setUrlCode(true)
    const { armOAuthCallbackWatchdog } = await loadWatchdog()

    armOAuthCallbackWatchdog(() => null)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sink).toHaveBeenCalledTimes(1)
    const call = sink.mock.calls[0]
    if (!call) throw new Error('expected a capture')
    const [, options] = call
    expect(options.tags).toMatchObject({ source: 'oauth', oauth_step: 'callback_unhandled' })
    expect(options.fingerprint).toEqual(['oauth-callback', 'unhandled'])
  })

  it('does not capture when markOAuthCallbackHandled() was called before the timeout', async () => {
    setUrlCode(true)
    const { armOAuthCallbackWatchdog, markOAuthCallbackHandled } = await loadWatchdog()

    armOAuthCallbackWatchdog(() => null)
    markOAuthCallbackHandled()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sink).not.toHaveBeenCalled()
  })

  it('does not capture when the token getter returns a non-null token', async () => {
    setUrlCode(true)
    const { armOAuthCallbackWatchdog } = await loadWatchdog()

    armOAuthCallbackWatchdog(() => 'a-token')
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sink).not.toHaveBeenCalled()
  })

  it('does not arm (no capture, no-op cleanup) when the URL carries no OAuth code', async () => {
    setUrlCode(false)
    const { armOAuthCallbackWatchdog } = await loadWatchdog()

    const cleanup = armOAuthCallbackWatchdog(() => null)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sink).not.toHaveBeenCalled()
    expect(() => cleanup()).not.toThrow()
  })

  it('does not capture once the returned cleanup has cancelled the timeout', async () => {
    setUrlCode(true)
    const { armOAuthCallbackWatchdog } = await loadWatchdog()

    const cleanup = armOAuthCallbackWatchdog(() => null)
    cleanup()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(sink).not.toHaveBeenCalled()
  })
})
