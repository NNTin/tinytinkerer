// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { InspectorRequestPayload, InspectorView, PluginModule } from '@tinytinkerer/contracts'

// One captured request the inspector store hands back. The mocks below let each
// test set whether the plugin is enabled and whether any request was captured.
const capturedRequest: InspectorRequestPayload = {
  model: 'openai/gpt-5',
  stream: true,
  stream_options: { include_usage: true },
  messages: [
    { role: 'system', content: 'SYSTEM PROMPT MARKER' },
    { role: 'user', content: 'USER MESSAGE MARKER' }
  ],
  area: 'models.chat',
  capturedAt: '2026-06-20T00:00:00.000Z'
}

let pluginActivation: Record<string, boolean> = {}
let requests: InspectorRequestPayload[] = []

vi.mock('../src/models.js', () => ({
  useModels: () => ({
    models: [
      {
        provider: 'litellm' as const,
        id: 'openai/gpt-5',
        label: 'gpt-5',
        kind: 'chat' as const,
        limits: { max_input_tokens: 100_000 }
      }
    ],
    isRefreshing: false,
    refreshError: null,
    refreshModels: () => Promise.resolve([])
  })
}))

vi.mock('../src/app.js', () => ({
  useChatStore: (selector: (state: { events: unknown[] }) => unknown) => selector({ events: [] }),
  useInspectorStore: (selector: (state: { requests: InspectorRequestPayload[] }) => unknown) =>
    selector({ requests }),
  useSettingsStore: (
    selector: (state: {
      selectedModel: string
      pluginActivation: Record<string, boolean>
    }) => unknown
  ) => selector({ selectedModel: 'openai/gpt-5', pluginActivation })
}))

// A real mapper stands in for the plugin's summarizeRequest so the panel renders
// realistic content without importing the concrete plugin package.
const summarizeRequest = (payload: InspectorRequestPayload): InspectorView => ({
  model: payload.model,
  stream: payload.stream,
  streamOptions: JSON.stringify(payload.stream_options ?? {}),
  ...(payload.area ? { area: payload.area } : {}),
  messageCount: payload.messages.length,
  approxTotalTokens: 42,
  messages: payload.messages.map((message, index) => ({
    index,
    role: message.role,
    isSystem: message.role === 'system',
    content: message.content,
    approxTokens: 21
  })),
  rawJson: JSON.stringify({ model: payload.model, messages: payload.messages }, null, 2)
})

const inspectorModule: PluginModule = {
  manifest: {
    id: 'context-inspector',
    label: 'Context inspector (developer)',
    description: 'dev',
    capabilities: ['inspector'],
    inspectorDescriptor: { id: 'context-inspector', summarizeRequest }
  },
  createPlugin: () => ({ id: 'context-inspector' })
}

vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: () => Promise.resolve([inspectorModule])
}))

// CodeMirror is irrelevant to this behavior and awkward under jsdom; render the
// JSON as plain text so we can still assert the raw payload is shown.
vi.mock('@tinytinkerer/content-code', () => ({
  ReadOnlyCodeView: ({ value }: { value: string }) => <pre>{value}</pre>
}))

import { ContextInspectorSlot, useContextInspector } from '../src/context-inspector.js'
import { renderHook } from '@testing-library/react'

describe('ContextInspectorSlot', () => {
  it('renders nothing when the inspector plugin is disabled', async () => {
    pluginActivation = {}
    requests = [capturedRequest]

    const { container } = render(<ContextInspectorSlot />)
    // Give the async plugin resolution a tick; it must resolve to no summarizer.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="context-inspector-toggle"]')).toBeNull()
    })
  })

  it('renders nothing when enabled but no request has been captured', async () => {
    pluginActivation = { 'context-inspector': true }
    requests = []

    const { container } = render(<ContextInspectorSlot />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('[data-testid="context-inspector-toggle"]')).toBeNull()
  })

  it('shows the toggle and opens a panel with the exact captured context when enabled', async () => {
    pluginActivation = { 'context-inspector': true }
    requests = [capturedRequest]

    render(<ContextInspectorSlot />)

    const toggle = await screen.findByTestId('context-inspector-toggle')
    fireEvent.click(toggle)

    const panel = await screen.findByTestId('context-inspector-panel')
    expect(panel).toBeTruthy()
    // The model and both messages (system + user) are shown.
    expect(panel.textContent).toContain('openai/gpt-5')
    expect(panel.textContent).toContain('SYSTEM PROMPT MARKER')
    expect(panel.textContent).toContain('USER MESSAGE MARKER')
    // Stream options are surfaced distinctly.
    expect(panel.textContent).toContain('include_usage')
  })
})

describe('useContextInspector', () => {
  it('exposes the model context window and resolves the active summarizer', async () => {
    pluginActivation = { 'context-inspector': true }
    requests = [capturedRequest]

    const { result } = renderHook(() => useContextInspector())
    await waitFor(() => expect(result.current.summarizer).not.toBeNull())
    expect(result.current.contextWindow).toBe(100_000)
    expect(result.current.requests).toHaveLength(1)
  })
})
