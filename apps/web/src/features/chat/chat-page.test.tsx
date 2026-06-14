import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type MockChatEvent = {
  id: string
  type: string
  timestamp?: string
  payload?: Record<string, unknown>
}

const mockSettingsState = vi.hoisted(() => ({
  hydrated: true,
  selectedModel: 'openai/gpt-4.1-mini',
  searchEnabled: true,
  webSpeechEnabled: false,
  showReasoningActivity: true,
  showCodeBlockFullscreenButton: true,
  initialize: vi.fn(),
  setSelectedModel: vi.fn(),
  setSearchEnabled: vi.fn(),
  setWebSpeechEnabled: vi.fn(),
  setShowReasoningActivity: vi.fn(),
  setShowCodeBlockFullscreenButton: vi.fn()
}))

const mockAuthState = vi.hoisted(() => ({
  token: null as string | null,
  clearToken: vi.fn(),
  setToken: vi.fn(),
  initialize: vi.fn()
}))

const mockStatusState = vi.hoisted(() => ({
  status: {
    auth: { state: 'ready', detail: 'GitHub auth available' },
    models: { state: 'degraded', detail: 'Model responses are slower than usual' },
    search: { state: 'offline', detail: 'Search temporarily unavailable', error: 'Upstream timeout' }
  },
  refresh: vi.fn()
}))

type MockActivity = {
  reasoningText: string
  items: Array<{ kind: string; id: string; label?: string; toolId?: string; status?: string }>
}

const emptyActivity = (): MockActivity => ({ reasoningText: '', items: [] })

const mockTurns = vi.hoisted(() => [] as Array<{
  id: string
  userText: string
  assistantSource: string
  assistantContent: { nodes: unknown[] } | null
  isStreaming: boolean
  activity: MockActivity
  notice?: {
    kind: 'system' | 'error' | 'rate-limit'
    message: string
    level?: 'info' | 'warning' | 'error'
  }
}>)

const mockChatState = vi.hoisted(() => ({
  events: [] as MockChatEvent[],
  isRunning: false,
  isRetryPending: false,
  cooldownUntil: undefined as string | undefined,
  submitPrompt: vi.fn(() => true),
  resetConversation: vi.fn(),
  cancelRetry: vi.fn()
}))

const mockSpeechState = vi.hoisted(() => ({
  visible: false,
  available: false,
  listening: false,
  error: null as string | null,
  toggle: vi.fn(() => Promise.resolve()),
  stop: vi.fn()
}))

vi.mock('@tinytinkerer/app-browser', async () => {
  const { useState } = await import('react')
  return {
  // Faithful stand-in for the shared composer hook: owns prompt state and the
  // submit → clear-on-accept behavior so the surface wiring can be exercised.
  // The hook's own logic is unit-tested in app-browser's surfaces test.
  useChatComposer: (submitPrompt: (prompt: string) => boolean) => {
    const [prompt, setPrompt] = useState('')
    const handleSubmit = (): boolean => {
      mockSpeechState.stop()
      const accepted = submitPrompt(prompt)
      if (accepted) {
        setPrompt('')
      }
      return accepted
    }
    return { prompt, setPrompt, speech: mockSpeechState, handleSubmit }
  },
  LazyBrowserSettingsModal: ({
    open,
    onOpenChange
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role="dialog" aria-label="Settings">
        <button type="button" aria-label="Close settings" onClick={() => onOpenChange(false)}>
          Close
        </button>
        <section role="region" aria-label="Auth">
          <p>Auth status</p>
          <p>{mockStatusState.status.auth.detail}</p>
          {mockAuthState.token ? null : (
            <button type="button">Sign in with GitHub</button>
          )}
        </section>
        <section role="region" aria-label="Models">
          <p>Models status</p>
          <p>{mockStatusState.status.models.detail}</p>
        </section>
        <section role="region" aria-label="Search">
          <p>Search status</p>
          <p>{mockStatusState.status.search.detail}</p>
          {mockStatusState.status.search.error ? <p>{mockStatusState.status.search.error}</p> : null}
          <label>
            Enable web search
            <input type="checkbox" disabled={mockStatusState.status.search.state !== 'ready'} />
          </label>
          {mockStatusState.status.search.state !== 'ready' ? (
            <p>Web search is unavailable right now. The runtime will skip search until the service recovers.</p>
          ) : null}
        </section>
        <section role="region" aria-label="Interface">
          <p>Interface</p>
        </section>
      </div>
    ) : null,
  AssistantContent: ({
    content,
    className,
    turnId
  }: {
    content: { nodes: Array<{ children?: Array<{ value?: string }> }> }
    className?: string
    turnId?: string
  }) => (
    <div className={className} data-turn-id={turnId}>
      {content.nodes[0]?.children?.[0]?.value}
    </div>
  ),
  TurnActivityPanel: ({ activity, isLive }: { activity: MockActivity; isLive: boolean }) => (
    <section aria-label="Reasoning and activity">
      <h3>Reasoning &amp; activity{isLive ? ' (live)' : ''}</h3>
      {activity.reasoningText ? <p>{activity.reasoningText}</p> : null}
      {activity.items.map((item) => (
        <span key={item.id}>{item.label ?? item.toolId}</span>
      ))}
    </section>
  ),
  useWebSpeechInput: () => mockSpeechState,
  useSettingsStore: () => [],
  useChatSurfaceController: () => ({
    isBooting: false,
    events: mockChatState.events,
    token: mockAuthState.token,
    turns: mockTurns,
    serverNameById: new Map<string, string>(),
    isRunning: mockChatState.isRunning,
    isRetryPending: mockChatState.isRetryPending,
    showReasoningActivity: mockSettingsState.showReasoningActivity,
    cooldownRemainingMs: 0,
    isCoolingDown: false,
    submitLabel: mockChatState.isRunning ? 'Thinking…' : 'Send',
    submitPrompt: mockChatState.submitPrompt,
    resetConversation: mockChatState.resetConversation,
    cancelRetry: mockChatState.cancelRetry
  })
  }
})

import { ChatPage } from './chat-page.js'

const renderChatPage = () => render(<ChatPage />)

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSettingsState.hydrated = true
  mockSettingsState.selectedModel = 'openai/gpt-4.1-mini'
  mockSettingsState.searchEnabled = true
  mockSettingsState.webSpeechEnabled = false
  mockSettingsState.showReasoningActivity = true
  mockAuthState.token = null
  mockChatState.events = []
  mockChatState.isRunning = false
  mockChatState.isRetryPending = false
  mockChatState.cooldownUntil = undefined
  mockChatState.submitPrompt.mockClear()
  mockChatState.submitPrompt.mockReturnValue(true)
  mockSpeechState.visible = false
  mockSpeechState.available = false
  mockSpeechState.listening = false
  mockSpeechState.error = null
  mockSpeechState.toggle.mockClear()
  mockSpeechState.stop.mockClear()
  mockStatusState.status = {
    auth: { state: 'ready', detail: 'GitHub auth available' },
    models: { state: 'degraded', detail: 'Model responses are slower than usual' },
    search: { state: 'offline', detail: 'Search temporarily unavailable', error: 'Upstream timeout' }
  }
  mockTurns.length = 0
})

describe('ChatPage layout', () => {
  it('bounds the page to viewport height', () => {
    const { container } = renderChatPage()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-screen')
    expect(root.className).not.toContain('min-h-screen')
  })

  it('gives the conversation section overflow-y-auto for in-place scrolling', () => {
    const { container } = renderChatPage()
    const scrollDiv = container.querySelector('section div.overflow-y-auto')
    expect(scrollDiv).not.toBeNull()
  })

  it('gives main overflow-hidden to contain layout within viewport', () => {
    const { container } = renderChatPage()
    const main = container.querySelector('main')
    expect(main?.className).toContain('overflow-hidden')
  })

  it('does not render a sticky top bar — navigation was moved into the composer', () => {
    const { container } = renderChatPage()
    expect(container.querySelector('header')).toBeNull()
  })
})

describe('ChatPage reasoning & activity panel', () => {
  it('renders the inline reasoning & activity panel for a turn when enabled', () => {
    mockTurns.push({
      id: 'turn-1',
      userText: 'hi',
      assistantSource: '',
      assistantContent: { nodes: [{ children: [{ value: 'reply' }] }] },
      isStreaming: false,
      activity: emptyActivity()
    })
    renderChatPage()
    expect(screen.getByRole('heading', { name: /reasoning & activity/i })).not.toBeNull()
  })

  it('hides the panel when showReasoningActivity is false', () => {
    mockSettingsState.showReasoningActivity = false
    mockTurns.push({
      id: 'turn-1',
      userText: 'hi',
      assistantSource: '',
      assistantContent: { nodes: [{ children: [{ value: 'reply' }] }] },
      isStreaming: false,
      activity: emptyActivity()
    })
    renderChatPage()
    expect(screen.queryByRole('heading', { name: /reasoning & activity/i })).toBeNull()
  })

  it('shows only the conversation and composer when the panel is disabled', () => {
    mockSettingsState.showReasoningActivity = false
    const { container } = renderChatPage()
    const sections = container.querySelectorAll('section')
    expect(sections).toHaveLength(1)
    expect(container.querySelector('form')).not.toBeNull()
  })

  it('passes turn.id through to AssistantContent', () => {
    mockTurns.push({
      id: 'turn-abc',
      userText: 'hi',
      assistantSource: '',
      assistantContent: { nodes: [{ children: [{ value: 'reply' }] }] },
      isStreaming: false,
      activity: emptyActivity()
    })
    const { container } = renderChatPage()
    expect(container.querySelector('[data-turn-id="turn-abc"]')).not.toBeNull()
  })
})

describe('ChatPage composer auth entry point', () => {
  it('shows "Sign in" button in the composer when not authenticated', () => {
    renderChatPage()
    expect(screen.getByRole('button', { name: /sign in with github/i })).not.toBeNull()
  })

  it('hides "Sign in" button from the composer when already authenticated', () => {
    mockAuthState.token = 'ghp_test_token'
    renderChatPage()
    expect(screen.queryByRole('button', { name: /sign in with github/i })).toBeNull()
  })
})

describe('ChatPage voice input button', () => {
  it('hides the voice button when Web Speech API is disabled in settings', () => {
    renderChatPage()
    expect(screen.queryByRole('button', { name: /voice input/i })).toBeNull()
  })

  it('renders a disabled voice button when the browser does not expose Web Speech API', () => {
    mockSpeechState.visible = true
    renderChatPage()
    expect(screen.getByRole('button', { name: /voice input unavailable/i })).toBeDisabled()
  })

  it('starts voice input when the browser supports it', () => {
    mockSpeechState.visible = true
    mockSpeechState.available = true
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: /voice input/i }))
    expect(mockSpeechState.toggle).toHaveBeenCalledTimes(1)
  })

  it('reflects the listening state on the voice button via aria-pressed', () => {
    mockSpeechState.visible = true
    mockSpeechState.available = true
    mockSpeechState.listening = true
    renderChatPage()
    expect(screen.getByRole('button', { name: /voice input/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('surfaces the speech error message to the user', () => {
    mockSpeechState.visible = true
    mockSpeechState.available = true
    mockSpeechState.error = 'Microphone access was denied.'
    renderChatPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access was denied.')
  })
})

describe('ChatPage settings modal', () => {
  it('modal is closed by default', () => {
    renderChatPage()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('opens the settings modal when the settings gear button is clicked', async () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).not.toBeNull()
  })

  it('shows auth, models, search, and interface sections with relocated status details', async () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('region', { name: 'Auth' })).not.toBeNull()
    expect(within(dialog).getByRole('region', { name: 'Models' })).not.toBeNull()
    expect(within(dialog).getByRole('region', { name: 'Search' })).not.toBeNull()
    expect(within(dialog).getByRole('region', { name: 'Interface' })).not.toBeNull()

    expect(await within(dialog).findByText('Auth status')).not.toBeNull()
    expect(await within(dialog).findByText('GitHub auth available')).not.toBeNull()
    expect(await within(dialog).findByText('Models status')).not.toBeNull()
    expect(await within(dialog).findByText('Model responses are slower than usual')).not.toBeNull()
    expect(await within(dialog).findByText('Search status')).not.toBeNull()
    expect(await within(dialog).findByText('Search temporarily unavailable')).not.toBeNull()
    expect(await within(dialog).findByText('Upstream timeout')).not.toBeNull()
  })

  it('shows auth controls in the real modal', async () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    const authRegion = within(dialog).getByRole('region', { name: 'Auth' })
    expect(await within(authRegion).findByRole('button', { name: /sign in with github/i })).not.toBeNull()
  })

  it('closes the modal when the close button is clicked', async () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('disables search controls when the service is unavailable', async () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    const checkbox = within(dialog).getByRole('checkbox', { name: /enable web search/i })
    expect(checkbox).toBeDisabled()
    expect(within(dialog).getByText(/runtime will skip search until the service recovers/i)).toBeInTheDocument()
  })
})

describe('ChatPage turns', () => {
  it('renders a notice and final answer within the same turn', () => {
    mockTurns.push({
      id: 'turn-1',
      userText: 'hello',
      assistantSource: 'Hi there.',
      assistantContent: {
        nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi there.' }] }]
      },
      isStreaming: false,
      activity: emptyActivity(),
      notice: {
        kind: 'rate-limit',
        message: 'Recovered after a short wait.',
        level: 'warning'
      }
    })

    renderChatPage()

    expect(screen.getByText('Recovered after a short wait.')).toBeInTheDocument()
    expect(screen.getByText('Hi there.')).toBeInTheDocument()
  })
})

describe('ChatPage composer submit (issue #206)', () => {
  it('clears the input immediately once a prompt is accepted', () => {
    renderChatPage()

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(/ask anything/i)
    fireEvent.change(textarea, { target: { value: 'What is new?' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    // submitPrompt resolves the accept/reject decision synchronously, so the
    // textarea is cleared without waiting for the backend response.
    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('What is new?')
    expect(textarea.value).toBe('')
  })

  it('does not clear the input when the send is rejected', () => {
    mockChatState.submitPrompt.mockReturnValue(false)
    renderChatPage()

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(/ask anything/i)
    fireEvent.change(textarea, { target: { value: 'Blocked message' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    expect(textarea.value).toBe('Blocked message')
  })

  it('disables sending while the agent is running', () => {
    mockChatState.isRunning = true
    renderChatPage()

    expect(screen.getByRole('button', { name: 'Thinking…' })).toBeDisabled()
  })
})
