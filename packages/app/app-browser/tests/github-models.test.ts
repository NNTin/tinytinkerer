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

import { fetchGitHubModels } from '../src/github-models.js'

const sink = vi.fn<CaptureExceptionSink>()

describe('fetchGitHubModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sink.mockReset()
    setCaptureExceptionSink(sink)
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
})
