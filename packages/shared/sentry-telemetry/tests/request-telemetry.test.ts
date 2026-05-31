import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setCaptureExceptionSink, type CaptureExceptionSink } from '../src/capture.js'
import {
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  parseWithTelemetry
} from '../src/request-telemetry.js'

const sink = vi.fn<CaptureExceptionSink>()

const metadata = {
  area: 'models.list',
  origin: 'edge' as const,
  method: 'GET',
  url: 'https://api.example.com/api/models/list?token=secret'
}

describe('request telemetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sink.mockReset()
    setCaptureExceptionSink(sink)
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  it('captures handled non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('{}', { status: 502, statusText: 'Bad Gateway' }))
      )
    )

    const response = await fetchWithTelemetry(metadata, {})

    expect(response.status).toBe(502)
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.level).toBe('error')
    expect(options?.tags).toMatchObject({
      request_area: 'models.list',
      http_status: 502,
      failure_kind: 'http_error'
    })
    expect(options?.contexts?.request).toMatchObject({
      host: 'api.example.com',
      path: '/api/models/list'
    })
  })

  it('captures aborted requests as warnings', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError'
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortError)))

    await expect(fetchWithTelemetry(metadata, {})).rejects.toBe(abortError)

    expect(sink).toHaveBeenCalledTimes(1)
    const [error, options] = sink.mock.calls[0] ?? []
    expect(error).toBe(abortError)
    expect(options?.level).toBe('warning')
    expect(options?.tags).toMatchObject({
      failure_kind: 'abort'
    })
  })

  it('skips capture for an accepted status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 404, statusText: 'Not Found' })))
    )

    const response = await fetchWithTelemetry(
      { ...metadata, accept: { status: [404], reason: '404 is an expected existence-check miss.' } },
      {}
    )

    expect(response.status).toBe(404)
    expect(sink).not.toHaveBeenCalled()
  })

  it('skips capture for an accepted failure kind', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError'
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortError)))

    await expect(
      fetchWithTelemetry(
        { ...metadata, accept: { kinds: ['abort'], reason: 'User can cancel the request.' } },
        {}
      )
    ).rejects.toBe(abortError)

    expect(sink).not.toHaveBeenCalled()
  })

  it('still captures outcomes outside the accept list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('{}', { status: 502, statusText: 'Bad Gateway' }))
      )
    )

    const response = await fetchWithTelemetry(
      { ...metadata, accept: { status: [404], reason: '404 is an expected existence-check miss.' } },
      {}
    )

    expect(response.status).toBe(502)
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('captures JSON parse failures', async () => {
    const response = new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })

    await expect(parseJsonWithTelemetry(metadata, response)).rejects.toThrow()

    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      failure_kind: 'parse_error'
    })
  })

  it('captures schema validation failures', () => {
    expect(() =>
      parseWithTelemetry(
        metadata,
        'schema_error',
        'Response schema mismatch',
        () => {
          throw new Error('schema mismatch')
        }
      )
    ).toThrow('schema mismatch')

    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      failure_kind: 'schema_error'
    })
  })

  it('no-ops when no sink is registered', async () => {
    setCaptureExceptionSink(null)
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })))
    )

    const response = await fetchWithTelemetry(metadata, {})

    expect(response.status).toBe(500)
    expect(sink).not.toHaveBeenCalled()
  })
})
