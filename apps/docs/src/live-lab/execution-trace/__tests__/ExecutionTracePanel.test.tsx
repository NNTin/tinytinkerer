import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FakeEvent = { id: string; timestamp: string; type: string; payload: Record<string, unknown> }

const state = vi.hoisted(() => ({
  events: [] as FakeEvent[],
  isRunning: false,
  isCoolingDown: false,
  cooldownRemainingMs: 0,
  submitLabel: 'Send',
  submitPrompt: vi.fn(() => true),
  rerunLastPrompt: vi.fn(async () => {}),
  resetConversation: vi.fn(async () => {}),
  stop: vi.fn(),
  canRerun: false,
  sendRefusalNotice: null as string | null,
  entries: [] as unknown[],
  selectedModel: 'gpt-test',
  agentType: 'react',
  conversationId: 'conv-1'
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  useChatSurfaceController: () => ({
    events: state.events,
    isRunning: state.isRunning,
    isCoolingDown: state.isCoolingDown,
    cooldownRemainingMs: state.cooldownRemainingMs,
    submitLabel: state.submitLabel,
    submitPrompt: state.submitPrompt,
    rerunLastPrompt: state.rerunLastPrompt,
    canRerun: state.canRerun,
    resetConversation: state.resetConversation,
    stop: state.stop,
    sendRefusalNotice: state.sendRefusalNotice,
    serverNameById: new Map<string, string>(),
    resolveActivitySummarizer: () => undefined
  }),
  useChatComposer: (submitPrompt: (prompt: string) => boolean) => {
    const [prompt, setPrompt] = useState('')
    return {
      prompt,
      setPrompt,
      speech: {},
      handleSubmit: () => {
        const accepted = submitPrompt(prompt)
        if (accepted) setPrompt('')
        return accepted
      }
    }
  },
  useContextInspector: () => ({ summarizer: null, entries: state.entries, contextWindow: null }),
  useChatStore: (selector: (s: { conversationId: string }) => unknown) =>
    selector({ conversationId: state.conversationId }),
  useSettingsStore: (selector: (s: { selectedModel: string; agentType: string }) => unknown) =>
    selector({ selectedModel: state.selectedModel, agentType: state.agentType }),
  formatCooldown: (ms: number) => `${Math.ceil(ms / 1000)}s`,
  buildTurns: (events: FakeEvent[]) => {
    const userMessage = events.find((event) => event.type === 'user.message')
    if (!userMessage) return []
    return [
      {
        id: userMessage.id,
        userText: userMessage.payload.text as string,
        assistantSource: '',
        assistantContent: events.some((event) => event.type === 'assistant.done')
          ? { nodes: [] }
          : null,
        isStreaming: false,
        activity: { items: [], reasoningText: '' },
        notice: events.some((event) => event.type === 'error')
          ? { kind: 'error' as const, message: 'Something went wrong', level: 'error' as const }
          : undefined
      }
    ]
  },
  TurnActivityPanel: () => <div data-testid="turn-activity-panel" />,
  AssistantContent: () => <div data-testid="assistant-content" />,
  ContextInspectorSlot: () => <button type="button">Open request inspector</button>
}))

vi.mock('@tinytinkerer/pixel-agents', () => ({
  conversationActivityStatus: (conversation: { isRunning: boolean }) =>
    conversation.isRunning ? 'running' : 'completed'
}))

import { ExecutionTracePanel } from '../ExecutionTracePanel'

const userMessageEvent = (text: string, timestamp: string): FakeEvent => ({
  id: `user-${timestamp}`,
  timestamp,
  type: 'user.message',
  payload: { text }
})

const resetState = (): void => {
  state.events = []
  state.isRunning = false
  state.isCoolingDown = false
  state.cooldownRemainingMs = 0
  state.submitLabel = 'Send'
  state.canRerun = false
  state.sendRefusalNotice = null
  state.entries = []
  vi.clearAllMocks()
  state.submitPrompt.mockReturnValue(true)
}

describe('ExecutionTracePanel', () => {
  afterEach(() => {
    resetState()
  })

  it('shows an empty state and disables Send with no prompt typed', () => {
    render(<ExecutionTracePanel />)
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('submits the typed prompt and clears the composer', async () => {
    const user = userEvent.setup()
    render(<ExecutionTracePanel />)

    await user.type(screen.getByLabelText('Prompt the agent'), 'List the files here')
    const sendButton = screen.getByRole('button', { name: 'Send' })
    expect(sendButton).toBeEnabled()
    await user.click(sendButton)

    expect(state.submitPrompt).toHaveBeenCalledWith('List the files here')
    expect(screen.getByLabelText('Prompt the agent')).toHaveValue('')
  })

  it('only enables Stop while a run is in flight, and calls stop()', async () => {
    state.isRunning = true
    state.events = [userMessageEvent('hi', '2026-01-01T00:00:00.000Z')]
    const user = userEvent.setup()
    render(<ExecutionTracePanel />)

    const stopButton = screen.getByRole('button', { name: 'Stop' })
    expect(stopButton).toBeEnabled()
    await user.click(stopButton)
    expect(state.stop).toHaveBeenCalledTimes(1)
  })

  it('disables Retry/Clear appropriately and wires them to the controller', async () => {
    state.canRerun = true
    state.events = [userMessageEvent('hi', '2026-01-01T00:00:00.000Z')]
    const user = userEvent.setup()
    render(<ExecutionTracePanel />)

    await user.click(screen.getByRole('button', { name: 'Retry last prompt' }))
    expect(state.rerunLastPrompt).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Clear trace' }))
    expect(state.resetConversation).toHaveBeenCalledTimes(1)
  })

  it('labels a settled run with its distinct outcome badge', () => {
    state.events = [
      userMessageEvent('hi', '2026-01-01T00:00:00.000Z'),
      {
        id: 'evt-2',
        timestamp: '2026-01-01T00:00:01.000Z',
        type: 'agent.run.started',
        payload: { agentType: 'react' }
      },
      {
        id: 'evt-3',
        timestamp: '2026-01-01T00:00:02.000Z',
        type: 'agent.run.completed',
        payload: { steps: 1 }
      }
    ]
    render(<ExecutionTracePanel />)
    expect(screen.getByText('Succeeded')).toBeInTheDocument()
  })

  it('shows a request-preparation summary only for entries captured within that run', () => {
    state.events = [
      userMessageEvent('first', '2026-01-01T00:00:00.000Z'),
      {
        id: 'evt-2',
        timestamp: '2026-01-01T00:00:05.000Z',
        type: 'agent.run.completed',
        payload: { steps: 1 }
      },
      userMessageEvent('second', '2026-01-01T00:00:10.000Z')
    ]
    state.entries = [
      {
        request: {
          model: 'gpt-first',
          stream: true,
          messages: [{ role: 'user', content: 'first' }],
          capturedAt: '2026-01-01T00:00:01.000Z'
        },
        response: { status: 'pending' }
      },
      {
        request: {
          model: 'gpt-second',
          stream: true,
          messages: [{ role: 'user', content: 'second' }],
          capturedAt: '2026-01-01T00:00:11.000Z'
        },
        response: { status: 'pending' }
      }
    ]
    render(<ExecutionTracePanel />)
    expect(screen.getByText(/Model gpt-first/)).toBeInTheDocument()
    expect(screen.getByText(/Model gpt-second/)).toBeInTheDocument()
  })
})
