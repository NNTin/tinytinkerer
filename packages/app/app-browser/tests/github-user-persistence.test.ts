// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'

const sink = vi.fn<CaptureExceptionSink>()

// Regression guard for TINYTINKERER-FRONTEND-G: the known-bad-token dedup must be
// DURABLE across a page reload. Before the fix it lived in a module-level Set that
// reset on every load, so a host-injected expired token (the widget surface, where
// clearToken() cannot remove a host token) was re-probed and re-captured a /user
// 401 on every reload. We simulate a reload with vi.resetModules() (fresh module
// state) while jsdom localStorage persists on the global.
describe('fetchGitHubUser durable known-bad token (TINYTINKERER-FRONTEND-G)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    sink.mockReset()
    setCaptureExceptionSink(sink)
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  it('does not re-probe a rejected token after a reload', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('', { status: 401 })))
    vi.stubGlobal('fetch', fetchSpy)

    // First page load: the token is probed once, found bad, and remembered durably.
    const first = await import('../src/github-user.js')
    const onUnauthorized = vi.fn()
    expect(await first.fetchGitHubUser('reload-stale-token', onUnauthorized)).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)

    // Simulate a page reload: fresh module state (empty in-memory set), but
    // localStorage survives. The persisted marker must short-circuit the probe.
    fetchSpy.mockClear()
    vi.resetModules()
    setCaptureExceptionSink(sink)
    const reloaded = await import('../src/github-user.js')
    const onUnauthorizedAfterReload = vi.fn()

    expect(
      await reloaded.fetchGitHubUser('reload-stale-token', onUnauthorizedAfterReload)
    ).toBeNull()
    // The durable marker means NO new /user probe — the regression was exactly
    // this re-probe firing a fresh 401 on every reload.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sink).not.toHaveBeenCalled()
    // The caller is still told to drop the token it is somehow still holding.
    expect(onUnauthorizedAfterReload).toHaveBeenCalledTimes(1)
  })

  it('still probes (once) a token never rejected before, even across reloads', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ login: 'octocat', avatar_url: 'https://x/y.png' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    )
    vi.stubGlobal('fetch', fetchSpy)

    const mod = await import('../src/github-user.js')
    const result = await mod.fetchGitHubUser('a-different-good-token')
    expect(result).toMatchObject({ login: 'octocat' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
