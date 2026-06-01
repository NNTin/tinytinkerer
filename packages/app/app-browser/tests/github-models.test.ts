import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_MODELS } from '@tinytinkerer/app-core'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'

vi.mock('../src/telemetry/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../src/telemetry/telemetry.js')>(
    '../src/telemetry/telemetry.js'
  )
  return {
    ...actual,
    getTelemetryHeaders: () => ({})
  }
})

import { clearModelsCache, fetchGitHubModels } from '../src/github-models.js'

const sink = vi.fn<CaptureExceptionSink>()

describe('fetchGitHubModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sink.mockReset()
    setCaptureExceptionSink(sink)
    // The models cache is module-level; reset it so a fallback cached in one
    // test doesn't short-circuit the next.
    clearModelsCache()
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  it('returns fallback models and emits telemetry for non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 502, statusText: 'Bad Gateway' })))
    )

    const models = await fetchGitHubModels('https://api.example.com', 'token')

    expect(models).toEqual([...SUPPORTED_MODELS])
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      request_area: 'models.list',
      http_status: 502,
      failure_kind: 'http_error'
    })
  })

  it('returns fallback models and emits telemetry for schema mismatches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ models: [{ id: 123 }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )

    const models = await fetchGitHubModels('https://api.example.com', 'token')

    expect(models).toEqual([...SUPPORTED_MODELS])
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      request_area: 'models.list',
      failure_kind: 'schema_error'
    })
  })

  it('briefly caches the fallback so a rate-limit storm is not re-probed on every call (TINYTINKERER-FRONTEND-5)', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }))
    )
    vi.stubGlobal('fetch', fetchSpy)

    const first = await fetchGitHubModels('https://api.example.com', 'token')
    const second = await fetchGitHubModels('https://api.example.com', 'token')

    expect(first).toEqual([...SUPPORTED_MODELS])
    expect(second).toEqual([...SUPPORTED_MODELS])
    // Second call is served from the negative cache: no extra fetch, no extra report.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each([429, 503])(
    'serves the fallback WITHOUT capturing the edge cooldown status %i (TINYTINKERER-FRONTEND-C / FRONTEND-D)',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('cooldown', { status })))
      )

      const models = await fetchGitHubModels('https://api.example.com', 'token')

      // Graceful degrade: serve the built-in list…
      expect(models).toEqual([...SUPPORTED_MODELS])
      // …and the edge's intentional cooldown/cache-miss signal is accepted, so it
      // is never reported (it is not a server-down bug).
      expect(sink).not.toHaveBeenCalled()
    }
  )

  it('still captures non-cooldown http errors (e.g. 502) at the models.list call site', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 502 })))
    )

    await fetchGitHubModels('https://api.example.com', 'token')

    // 502 is not an accepted cooldown status — it still reports.
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({ request_area: 'models.list', http_status: 502 })
  })

  it('serves the LAST-KNOWN list (not the built-in defaults) when a later fetch hits an edge cooldown', async () => {
    vi.useFakeTimers()
    try {
      const lastKnown = [
        { id: 'openai/gpt-4.1', label: 'GPT-4.1' },
        { id: 'openai/o4-mini', label: 'o4-mini' }
      ]
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ models: lastKnown }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
        .mockResolvedValue(new Response('cooldown', { status: 503 }))
      vi.stubGlobal('fetch', fetchSpy)

      // First fetch succeeds and is remembered as the last-known catalogue.
      const first = await fetchGitHubModels('https://api.example.com', 'token')
      expect(first).toEqual(lastKnown)

      // Advance past the success TTL (5 min) so the next call re-fetches and the
      // edge answers with its cooldown signal.
      vi.advanceTimersByTime(6 * 60_000)

      const second = await fetchGitHubModels('https://api.example.com', 'token')
      // Degrade to the LAST-KNOWN real list, not the built-in SUPPORTED_MODELS.
      expect(second).toEqual(lastKnown)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(sink).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
