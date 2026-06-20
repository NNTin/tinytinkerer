import {
  isPluginModule,
  type InspectorEntry,
  type InspectorRequestPayload,
  type InspectorResponse
} from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import * as contextInspectorModule from '../src/index'
import {
  CONTEXT_INSPECTOR_PLUGIN_ID,
  contextInspectorPlugin,
  contextInspectorPluginManifest,
  summarizeRequest
} from '../src/index'

const payload = (overrides: Partial<InspectorRequestPayload> = {}): InspectorRequestPayload => ({
  model: 'openai/gpt-5',
  stream: true,
  stream_options: { include_usage: true },
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello there, how are you?' }
  ],
  area: 'models.chat',
  capturedAt: '2026-06-20T00:00:00.000Z',
  ...overrides
})

const entry = (
  response: InspectorResponse = { status: 'pending' },
  overrides: Partial<InspectorRequestPayload> = {}
): InspectorEntry => ({ request: payload(overrides), response })

describe('summarizeRequest', () => {
  it('maps a payload to a view with per-message rows and an approx total', () => {
    const view = summarizeRequest(entry())

    expect(view).toMatchObject({
      model: 'openai/gpt-5',
      stream: true,
      streamOptions: '{"include_usage":true}',
      area: 'models.chat',
      messageCount: 2
    })
    expect(view.messages).toHaveLength(2)
    expect(view.messages[0]).toMatchObject({ index: 0, role: 'system', isSystem: true })
    expect(view.messages[1]).toMatchObject({ index: 1, role: 'user', isSystem: false })
    // ~4 chars/token heuristic, summed across messages.
    const expectedTotal = view.messages.reduce((sum, m) => sum + m.approxTokens, 0)
    expect(view.approxTotalTokens).toBe(expectedTotal)
    expect(view.messages[0]?.approxTokens).toBe(
      Math.ceil('You are a helpful assistant.'.length / 4)
    )
  })

  it('serializes the exact forwarded body as pretty JSON for the host renderer', () => {
    const view = summarizeRequest(entry())
    const parsed = JSON.parse(view.rawJson) as Record<string, unknown>

    expect(parsed).toEqual({
      model: 'openai/gpt-5',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello there, how are you?' }
      ]
    })
    // Pretty-printed (indented) so the JSON view is readable.
    expect(view.rawJson).toContain('\n  ')
  })

  it('omits stream_options and area cleanly when absent', () => {
    const view = summarizeRequest({
      request: {
        model: 'openai/gpt-5',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        capturedAt: '2026-06-20T00:00:00.000Z'
      },
      response: { status: 'pending' }
    })

    expect(view.streamOptions).toBe('{}')
    expect(view.area).toBeUndefined()
    expect(view.rawJson).not.toContain('stream_options')
  })
})

describe('summarizeRequest — response', () => {
  it('maps an ok response to content + usage with an output estimate', () => {
    const view = summarizeRequest(
      entry({ status: 'ok', httpStatus: 200, content: 'Hello!', usage: { promptTokens: 12 } })
    )

    expect(view.response).toMatchObject({
      status: 'ok',
      label: 'Response',
      content: 'Hello!',
      usage: { promptTokens: 12 },
      approxResponseTokens: Math.ceil('Hello!'.length / 4)
    })
  })

  it('maps a 429 to a rate-limited view that states no tokens were consumed', () => {
    const view = summarizeRequest(
      entry({ status: 'rate_limited', httpStatus: 429, retryAfterMs: 5000 })
    )

    expect(view.response.status).toBe('rate_limited')
    if (view.response.status === 'rate_limited') {
      expect(view.response.label).toContain('429')
      expect(view.response.note).toMatch(/no tokens were consumed/i)
      expect(view.response.retryAfterMs).toBe(5000)
    }
  })

  it('reports a pending response before it resolves', () => {
    expect(summarizeRequest(entry()).response).toEqual({
      status: 'pending',
      label: 'Waiting for response…'
    })
  })
})

describe('manifest', () => {
  it('is a valid, off-by-default inspector plugin module', () => {
    expect(isPluginModule(contextInspectorModule)).toBe(true)
    expect(contextInspectorPluginManifest.id).toBe(CONTEXT_INSPECTOR_PLUGIN_ID)
    expect(contextInspectorPluginManifest.capabilities).toEqual(['inspector'])
    expect(contextInspectorPluginManifest.defaultEnabled).toBeUndefined()
    expect(contextInspectorPluginManifest.inspectorDescriptor?.summarizeRequest).toBe(
      summarizeRequest
    )
    expect(contextInspectorPlugin().id).toBe(CONTEXT_INSPECTOR_PLUGIN_ID)
  })
})
