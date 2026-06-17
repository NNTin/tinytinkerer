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
      vi.fn(() => Promise.resolve(new Response('{}', { status: 502, statusText: 'Bad Gateway' })))
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

  it('adds sanitized model metadata and fingerprints model failures separately', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 502, statusText: 'Bad Gateway' })))
    )

    await fetchWithTelemetry({ ...metadata, area: 'models.chat', model: 'openai/gpt-5' }, {})
    await fetchWithTelemetry({ ...metadata, area: 'models.chat', model: 'openai/gpt-4.1-mini' }, {})

    const [, firstOptions] = sink.mock.calls[0] ?? []
    const [, secondOptions] = sink.mock.calls[1] ?? []
    expect(firstOptions?.tags).toMatchObject({ model: 'openai/gpt-5' })
    expect(firstOptions?.contexts?.request).toMatchObject({ model: 'openai/gpt-5' })
    expect(firstOptions?.fingerprint).toContain('model:openai/gpt-5')
    expect(secondOptions?.fingerprint).toContain('model:openai/gpt-4.1-mini')
    expect(firstOptions?.fingerprint).not.toEqual(secondOptions?.fingerprint)
  })

  it('hashes unsafe custom model strings before sending telemetry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 500 })))
    )

    await fetchWithTelemetry({ ...metadata, model: 'secret model value' }, {})

    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags?.['model']).toMatch(/^custom:[0-9a-f]{8}$/)
    expect(options?.tags?.['model']).not.toContain('secret')
    expect(options?.fingerprint?.at(-1)).toBe(`model:${options?.tags?.['model']}`)
  })

  it('fingerprints by area + kind + status so endpoints/statuses do not conflate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('{}', { status: 429, statusText: 'Too Many Requests' }))
      )
    )

    await fetchWithTelemetry({ ...metadata, area: 'models.list' }, {})
    await fetchWithTelemetry({ ...metadata, area: 'models.chat' }, {})

    const listFingerprint = sink.mock.calls[0]?.[1]?.fingerprint
    const chatFingerprint = sink.mock.calls[1]?.[1]?.fingerprint
    expect(listFingerprint).toEqual(['request-telemetry', 'models.list', 'http_error', '429'])
    expect(chatFingerprint).toEqual(['request-telemetry', 'models.chat', 'http_error', '429'])
    // Same frame (normalizeError) but distinct fingerprints → distinct issues.
    expect(listFingerprint).not.toEqual(chatFingerprint)
  })

  it('captures aborted requests as warnings', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(abortError))
    )

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
      {
        ...metadata,
        accept: { status: [404], reason: '404 is an expected existence-check miss.' }
      },
      {}
    )

    expect(response.status).toBe(404)
    expect(sink).not.toHaveBeenCalled()
  })

  it('skips capture for an accepted failure kind', async () => {
    const abortError = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError'
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(abortError))
    )

    await expect(
      fetchWithTelemetry(
        { ...metadata, accept: { kinds: ['abort'], reason: 'User can cancel the request.' } },
        {}
      )
    ).rejects.toBe(abortError)

    expect(sink).not.toHaveBeenCalled()
  })

  it('skips capture for an accepted network_error kind', async () => {
    const networkError = new TypeError('Failed to fetch')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(networkError))
    )

    await expect(
      fetchWithTelemetry(
        {
          ...metadata,
          accept: { kinds: ['network_error'], reason: 'Transient background network failure.' }
        },
        {}
      )
    ).rejects.toBe(networkError)

    expect(sink).not.toHaveBeenCalled()
  })

  it('still captures outcomes outside the accept list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 502, statusText: 'Bad Gateway' })))
    )

    const response = await fetchWithTelemetry(
      {
        ...metadata,
        accept: { status: [404], reason: '404 is an expected existence-check miss.' }
      },
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
      parseWithTelemetry(metadata, 'schema_error', 'Response schema mismatch', () => {
        throw new Error('schema mismatch')
      })
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
