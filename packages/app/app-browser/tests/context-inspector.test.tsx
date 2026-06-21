// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InspectorEntry, InspectorView, PluginModule } from '@tinytinkerer/contracts'

// One captured entry the inspector store hands back. The mocks below let each test
// set whether the plugin is enabled and whether anything was captured.
const capturedEntry: InspectorEntry = {
  request: {
    model: 'openai/gpt-5',
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: 'SYSTEM PROMPT MARKER' },
      { role: 'user', content: 'USER MESSAGE MARKER' }
    ],
    area: 'models.chat',
    capturedAt: '2026-06-20T00:00:00.000Z'
  },
  response: {
    status: 'ok',
    httpStatus: 200,
    content: 'RESPONSE MARKER',
    usage: { promptTokens: 8 }
  }
}

let pluginActivation: Record<string, boolean> = {}
let entries: InspectorEntry[] = []

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
  useInspectorStore: (selector: (state: { entries: InspectorEntry[] }) => unknown) =>
    selector({ entries }),
  useSettingsStore: (
    selector: (state: {
      selectedModel: string
      pluginActivation: Record<string, boolean>
    }) => unknown
  ) => selector({ selectedModel: 'openai/gpt-5', pluginActivation })
}))

// A real mapper stands in for the plugin's summarizeRequest so the panel renders
// realistic content without importing the concrete plugin package.
const summarizeRequest = (entry: InspectorEntry): InspectorView => {
  const { request, response } = entry
  return {
    model: request.model,
    stream: request.stream,
    streamOptions: JSON.stringify(request.stream_options ?? {}),
    ...(request.area ? { area: request.area } : {}),
    messageCount: request.messages.length,
    approxTotalTokens: 42,
    messages: request.messages.map((message, index) => ({
      index,
      role: message.role,
      isSystem: message.role === 'system',
      content: message.content,
      approxTokens: 21
    })),
    rawJson: JSON.stringify({ model: request.model, messages: request.messages }, null, 2),
    response:
      response.status === 'ok'
        ? {
            status: 'ok',
            label: 'Response',
            content: response.content,
            ...(response.usage ? { usage: response.usage } : {}),
            approxResponseTokens: Math.ceil(response.content.length / 4)
          }
        : response.status === 'rate_limited'
          ? {
              status: 'rate_limited',
              label: `Rate limited (HTTP ${response.httpStatus})`,
              note: 'Rate limited — no tokens were consumed.'
            }
          : response.status === 'error'
            ? { status: 'error', label: `Error (HTTP ${response.httpStatus})` }
            : { status: 'pending', label: 'Waiting for response…' }
  }
}

const inspectorModule: PluginModule = {
  manifest: {
    id: 'context-inspector',
    label: 'Context inspector (developer)',
    description: 'dev',
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
import { ContextInspectorPanel } from '../src/context-inspector-panel.js'
import { renderHook } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// The slot's visibility logic. The open→panel flow uses React.lazy and is covered
// end-to-end by the e2e spec; the panel's content is asserted directly below to
// avoid a Suspense boundary in the unit environment.
describe('ContextInspectorSlot', () => {
  it('renders nothing when the inspector plugin is disabled', async () => {
    pluginActivation = {}
    entries = [capturedEntry]

    const { container } = render(<ContextInspectorSlot />)
    await waitFor(() => {
      expect(container.querySelector('[data-testid="context-inspector-toggle"]')).toBeNull()
    })
  })

  it('renders nothing when enabled but nothing has been captured', async () => {
    pluginActivation = { 'context-inspector': true }
    entries = []

    const { container } = render(<ContextInspectorSlot />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('[data-testid="context-inspector-toggle"]')).toBeNull()
  })

  it('shows the toggle once enabled and something has been captured', async () => {
    pluginActivation = { 'context-inspector': true }
    entries = [capturedEntry]

    render(<ContextInspectorSlot icon={<span>RCPT</span>} />)
    expect(await screen.findByTestId('context-inspector-toggle')).toBeTruthy()
  })
})

describe('ContextInspectorPanel', () => {
  const noop = () => {}

  it('shows the exact request, the paired response, and the real prompt-token count', () => {
    render(
      <ContextInspectorPanel
        view={summarizeRequest(capturedEntry)}
        requestCount={1}
        selectedIndex={0}
        onSelectIndex={noop}
        contextWindow={100_000}
        onClose={noop}
      />
    )

    const panel = screen.getByTestId('context-inspector-panel')
    expect(panel.textContent).toContain('openai/gpt-5')
    expect(panel.textContent).toContain('SYSTEM PROMPT MARKER')
    expect(panel.textContent).toContain('USER MESSAGE MARKER')
    expect(panel.textContent).toContain('include_usage')

    expect(screen.getByTestId('context-inspector-response').textContent).toContain(
      'RESPONSE MARKER'
    )
    // Real per-request usage is surfaced (not an estimate) when reported.
    expect(screen.getByTestId('context-inspector-tokens').textContent).toContain('8 prompt tokens')
  })

  it('shows a rate-limited response that states no tokens were consumed', () => {
    const view = summarizeRequest({
      request: capturedEntry.request,
      response: { status: 'rate_limited', httpStatus: 429 }
    })
    render(
      <ContextInspectorPanel
        view={view}
        requestCount={1}
        selectedIndex={0}
        onSelectIndex={noop}
        contextWindow={100_000}
        onClose={noop}
      />
    )

    const response = screen.getByTestId('context-inspector-response')
    expect(response.textContent).toContain('Rate limited')
    expect(response.textContent).toMatch(/no tokens were consumed/i)
    // Falls back to the estimate since no usage was reported.
    expect(screen.getByTestId('context-inspector-tokens').textContent).toContain('estimate')
  })
})

describe('useContextInspector', () => {
  it('exposes the model context window and resolves the active summarizer', async () => {
    pluginActivation = { 'context-inspector': true }
    entries = [capturedEntry]

    const { result } = renderHook(() => useContextInspector())
    await waitFor(() => expect(result.current.summarizer).not.toBeNull())
    expect(result.current.contextWindow).toBe(100_000)
    expect(result.current.entries).toHaveLength(1)
  })
})
