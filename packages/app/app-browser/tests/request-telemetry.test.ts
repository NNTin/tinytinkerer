import { beforeEach, describe, expect, it, vi } from 'vitest'

type CaptureTelemetryException = typeof import('../src/telemetry/telemetry.js').captureTelemetryException

const telemetryMocks = vi.hoisted(() => ({
  captureTelemetryException: vi.fn<CaptureTelemetryException>()
}))

vi.mock('../src/telemetry/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../src/telemetry/telemetry.js')>(
    '../src/telemetry/telemetry.js'
  )
  return {
    ...actual,
    captureTelemetryException: telemetryMocks.captureTelemetryException
  }
})

import {
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  parseWithTelemetry
} from '../src/telemetry/request-telemetry.js'

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
    telemetryMocks.captureTelemetryException.mockReset()
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
    expect(telemetryMocks.captureTelemetryException).toHaveBeenCalledTimes(1)
    const [, options] = vi.mocked(telemetryMocks.captureTelemetryException).mock.calls[0] ?? []
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

    expect(telemetryMocks.captureTelemetryException).toHaveBeenCalledTimes(1)
    const [error, options] = vi.mocked(telemetryMocks.captureTelemetryException).mock.calls[0] ?? []
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
    expect(telemetryMocks.captureTelemetryException).not.toHaveBeenCalled()
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

    expect(telemetryMocks.captureTelemetryException).not.toHaveBeenCalled()
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
    expect(telemetryMocks.captureTelemetryException).toHaveBeenCalledTimes(1)
  })

  it('captures JSON parse failures', async () => {
    const response = new Response('not-json', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })

    await expect(parseJsonWithTelemetry(metadata, response)).rejects.toThrow()

    expect(telemetryMocks.captureTelemetryException).toHaveBeenCalledTimes(1)
    const [, options] = vi.mocked(telemetryMocks.captureTelemetryException).mock.calls[0] ?? []
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

    expect(telemetryMocks.captureTelemetryException).toHaveBeenCalledTimes(1)
    const [, options] = vi.mocked(telemetryMocks.captureTelemetryException).mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      failure_kind: 'schema_error'
    })
  })
})
