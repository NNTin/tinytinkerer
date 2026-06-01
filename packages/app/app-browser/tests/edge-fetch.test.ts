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

  it('does not capture a 429 — rate limits surface as a cooldown (TINYTINKERER-FRONTEND-9)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{"code":"rate_limited"}', { status: 429 })))
    )

    const edgeFetch = createEdgeFetch('http://example.com', () => 'token')
    const response = await edgeFetch(
      '/api/models/chat',
      { prompt: 'hi' },
      { area: 'react.decide', stream: true }
    )

    expect(response.status).toBe(429)
    expect(sink).not.toHaveBeenCalled()
  })

  it('still captures a non-429 http error on the same call site', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 })))
    )

    const edgeFetch = createEdgeFetch('http://example.com', () => 'token')
    const response = await edgeFetch('/api/models/chat', { prompt: 'hi' }, { area: 'react.decide' })

    expect(response.status).toBe(500)
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({ request_area: 'react.decide', http_status: 500 })
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
