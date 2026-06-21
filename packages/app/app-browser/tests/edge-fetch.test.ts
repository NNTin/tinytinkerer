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

import { MAX_CHAT_MESSAGE_CONTENT_CHARS, type InspectorResponse } from '@tinytinkerer/contracts'
import {
  createEdgeFetch,
  createModelsChatFetch,
  modelsChatRequestBody,
  type ForwardedRequestSink
} from '../src/runtime/edge-fetch.js'

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
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(abortError))
    )

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
    const response = await edgeFetch(
      '/api/models/chat',
      { prompt: 'hi' },
      { area: 'react.decide', model: 'openai/gpt-5' }
    )

    expect(response.status).toBe(500)
    expect(sink).toHaveBeenCalledTimes(1)
    const [, options] = sink.mock.calls[0] ?? []
    expect(options?.tags).toMatchObject({
      request_area: 'react.decide',
      http_status: 500,
      model: 'openai/gpt-5'
    })
    expect(options?.fingerprint).toContain('model:openai/gpt-5')
  })

  it('still captures a genuine network error on the same call site', async () => {
    const networkError = new TypeError('Failed to fetch')
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(networkError))
    )

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

describe('modelsChatRequestBody', () => {
  const init = {
    model: 'openai/gpt-5',
    stream: false,
    messages: [{ role: 'user' as const, content: 'hi' }]
  }

  it('omits litellmBaseUrl for the deployment-default sentinel so the edge resolves its own URL (issue #179)', () => {
    expect(modelsChatRequestBody(undefined, init)).toEqual({ ...init })
    expect(modelsChatRequestBody('', init)).not.toHaveProperty('litellmBaseUrl')
    expect(modelsChatRequestBody('   ', init)).not.toHaveProperty('litellmBaseUrl')
  })

  it('includes an explicitly configured litellmBaseUrl', () => {
    expect(modelsChatRequestBody('https://litellm.example.com/', init)).toEqual({
      litellmBaseUrl: 'https://litellm.example.com/',
      ...init
    })
  })

  it('clamps oversized message content to the edge ceiling so it cannot 400 (FRONTEND-14/15)', () => {
    const huge = 'x'.repeat(MAX_CHAT_MESSAGE_CONTENT_CHARS + 5_000)
    const body = modelsChatRequestBody(undefined, {
      model: 'm',
      stream: false,
      messages: [
        { role: 'system' as const, content: 'ok' },
        { role: 'user' as const, content: huge }
      ]
    }) as { messages: { role: string; content: string }[] }

    expect(body.messages[0]!.content).toBe('ok') // small content untouched
    const clamped = body.messages[1]!.content
    expect(clamped.length).toBe(MAX_CHAT_MESSAGE_CONTENT_CHARS)
    // The appended notice is self-describing and actionable, not a bare marker.
    expect(clamped).toMatch(/truncated to the model's \d+-char per-message limit/)
    expect(clamped).toMatch(/smaller or aggregated result/)
  })
})

describe('createModelsChatFetch', () => {
  it('posts the prelude-built body to /api/models/chat with model/stream telemetry', async () => {
    let capturedUrl = ''
    let capturedBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, requestInit?: RequestInit) => {
        capturedUrl =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        capturedBody = requestInit?.body as string | undefined
        return Promise.resolve(new Response('{}', { status: 200 }))
      })
    )

    const edgeFetch = createEdgeFetch('http://example.com', () => 'token')
    const modelsChat = createModelsChatFetch(edgeFetch, () => 'https://litellm.example.com/')

    await modelsChat(
      {
        model: 'openai/gpt-5',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }]
      },
      { area: 'react.decide' }
    )

    expect(capturedUrl).toBe('http://example.com/api/models/chat')
    expect(JSON.parse(capturedBody ?? '{}')).toMatchObject({
      litellmBaseUrl: 'https://litellm.example.com/',
      model: 'openai/gpt-5',
      stream: true
    })
  })

  it('omits litellmBaseUrl when no getter is wired (deployment default)', async () => {
    let capturedBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, requestInit?: RequestInit) => {
        capturedBody = requestInit?.body as string | undefined
        return Promise.resolve(new Response('{}', { status: 200 }))
      })
    )

    const edgeFetch = createEdgeFetch('http://example.com', () => 'token')
    const modelsChat = createModelsChatFetch(edgeFetch)

    await modelsChat({
      model: 'openai/gpt-5',
      stream: false,
      messages: [{ role: 'user', content: 'hi' }]
    })

    expect(JSON.parse(capturedBody ?? '{}')).not.toHaveProperty('litellmBaseUrl')
  })
})

describe('createModelsChatFetch — inspector capture', () => {
  // A missing response in the panel must NOT be a silent gap, so capture failures
  // are reported to telemetry. Wire the shared exception sink to assert on it.
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    sink.mockReset()
    setCaptureExceptionSink(sink)
  })

  afterEach(() => {
    setCaptureExceptionSink(null)
  })

  // Drive a request through the chokepoint with an inspector sink wired, then wait
  // for the (async, tee'd) response capture to settle and return it.
  const captureFor = async (response: Response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(response))
    )
    let captured: InspectorResponse | undefined
    const requestSink: ForwardedRequestSink = () => (r) => {
      captured = r
    }
    const edgeFetch = createEdgeFetch('http://example.com', () => 'token')
    const modelsChat = createModelsChatFetch(edgeFetch, undefined, requestSink)
    await modelsChat(
      { model: 'openai/gpt-5', stream: true, messages: [{ role: 'user', content: 'hi' }] },
      { area: 'models.chat' }
    )
    await vi.waitFor(() => expect(captured).toBeDefined())
    return captured!
  }

  it('reports a 429 as rate_limited (no tokens consumed)', async () => {
    const captured = await captureFor(
      new Response('{"code":"rate_limited"}', {
        status: 429,
        headers: { 'retry-after': '5' }
      })
    )
    expect(captured).toMatchObject({ status: 'rate_limited', httpStatus: 429, retryAfterMs: 5000 })
  })

  it('reports a non-stream JSON response with content and usage', async () => {
    const captured = await captureFor(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello there' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )
    expect(captured).toMatchObject({
      status: 'ok',
      httpStatus: 200,
      content: 'hello there',
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 }
    })
  })

  it('accumulates an SSE response stream into content + usage', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":9}}\n' +
      'data: [DONE]\n'
    const captured = await captureFor(
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    )
    expect(captured).toMatchObject({
      status: 'ok',
      httpStatus: 200,
      content: 'Hello',
      usage: { promptTokens: 9 }
    })
  })

  it('reports a non-429 http error', async () => {
    const captured = await captureFor(new Response('boom', { status: 500 }))
    expect(captured).toMatchObject({ status: 'error', httpStatus: 500 })
  })

  it('sends a telemetry error when a 200 OK response yields no content (not silent)', async () => {
    const captured = await captureFor(
      new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(captured).toMatchObject({ status: 'ok', httpStatus: 200, content: '' })

    expect(sink).toHaveBeenCalledTimes(1)
    const [error, options] = sink.mock.calls[0] ?? []
    expect(error?.message).toContain('context-inspector response capture failed')
    expect(options?.level).toBe('error')
    expect(options?.tags).toMatchObject({
      source: 'context-inspector',
      capture_stage: 'empty',
      request_area: 'models.chat',
      model: 'openai/gpt-5'
    })
  })

  it('does NOT send telemetry for a normal non-empty response', async () => {
    await captureFor(
      new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    expect(sink).not.toHaveBeenCalled()
  })
})
