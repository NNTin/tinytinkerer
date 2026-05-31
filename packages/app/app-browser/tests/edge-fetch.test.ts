import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { createEdgeFetch } from '../src/runtime/edge-fetch.js'

const sink = vi.fn<CaptureExceptionSink>()

describe('createEdgeFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sink.mockReset()
    setCaptureExceptionSink(sink)
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  it('does not capture AbortError — runtime/user cancellations are expected (TINYTINKERER-FRONTEND-A)', async () => {
    const abortError = Object.assign(new Error('signal is aborted without reason'), {
      name: 'AbortError'
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortError)))

    const edgeFetch = createEdgeFetch('http://example.com', () => 'token')

    await expect(
      edgeFetch('/api/models/chat', { prompt: 'hi' }, { area: 'react.decide', stream: true })
    ).rejects.toBe(abortError)
    expect(sink).not.toHaveBeenCalled()
  })

  it('still captures a genuine network error on the same call site', async () => {
    const networkError = new TypeError('Failed to fetch')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(networkError)))

    const edgeFetch = createEdgeFetch('http://example.com', () => 'token')

    await expect(
      edgeFetch('/api/models/chat', { prompt: 'hi' }, { area: 'react.decide' })
    ).rejects.toBe(networkError)
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      request_area: 'react.decide',
      failure_kind: 'network_error'
    })
  })
})
