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
