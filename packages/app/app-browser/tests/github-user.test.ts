import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'

import { fetchGitHubUser } from '../src/github-user.js'

const sink = vi.fn<CaptureExceptionSink>()

describe('fetchGitHubUser', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sink.mockReset()
    setCaptureExceptionSink(sink)
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  it('does not probe /user without a real token (TINYTINKERER-FRONTEND-4)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    expect(await fetchGitHubUser('   ')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(sink).not.toHaveBeenCalled()
  })

  it('invokes onUnauthorized so the caller can drop a rejected token on a 401', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 401 }))))
    const onUnauthorized = vi.fn()

    const result = await fetchGitHubUser('expired-token', onUnauthorized)

    expect(result).toBeNull()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('probes a stale token once for concurrent callers (TINYTINKERER-FRONTEND-4)', async () => {
    // The two surfaces (consent-gate + app shell) mount together. They must share
    // one /user probe so a stale token captures a single 401, not one per surface.
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('', { status: 401 })))
    vi.stubGlobal('fetch', fetchSpy)

    const [a, b] = await Promise.all([
      fetchGitHubUser('concurrent-stale-token'),
      fetchGitHubUser('concurrent-stale-token')
    ])

    expect(a).toBeNull()
    expect(b).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('never re-probes a token GitHub already rejected (TINYTINKERER-FRONTEND-4)', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response('', { status: 401 })))
    vi.stubGlobal('fetch', fetchSpy)
    const onUnauthorized = vi.fn()

    // First probe discovers the token is bad (one capture).
    expect(await fetchGitHubUser('known-bad-token', onUnauthorized)).toBeNull()
    // A later mount with the same token short-circuits: no fetch, no new capture,
    // but the caller is still told to drop it.
    expect(await fetchGitHubUser('known-bad-token', onUnauthorized)).toBeNull()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(onUnauthorized).toHaveBeenCalledTimes(2)
  })

  it('does not capture a transient network failure (TINYTINKERER-FRONTEND-7)', async () => {
    const networkError = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(networkError)))

    const result = await fetchGitHubUser('valid-token')

    expect(result).toBeNull()
    // network_error is accepted at this call site; a real http_error (e.g. 401) still captures.
    expect(sink).not.toHaveBeenCalled()
  })

  it('returns the user and leaves the token in place on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ login: 'octocat', name: 'The Octocat', avatar_url: 'https://x/y.png' }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
        )
      )
    )
    const onUnauthorized = vi.fn()

    const result = await fetchGitHubUser('valid-token', onUnauthorized)

    expect(result).toMatchObject({ login: 'octocat', name: 'The Octocat' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
