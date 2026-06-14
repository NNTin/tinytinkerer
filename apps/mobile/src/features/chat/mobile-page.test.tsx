import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
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
  LazyBrowserSettingsModal: () => null,
  PermissionModal: () => null,
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

import { MobilePage } from './mobile-page.js'

const renderMobilePage = () => render(<MobilePage />)

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
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
  mockTurns.length = 0
})

describe('MobilePage', () => {
  it('bounds the page to the dynamic viewport height', () => {
    const { container } = renderMobilePage()
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-[100dvh]')
    expect(root.className).not.toContain('min-h-screen')
  })

  it('shows an install button when the PWA install prompt becomes available', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined)
    const installEvent = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
      preventDefault: () => void
    }

    installEvent.prompt = prompt
    installEvent.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' })
    installEvent.preventDefault = vi.fn()

    renderMobilePage()

    act(() => {
      window.dispatchEvent(installEvent)
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /install app/i }))
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('renders the inline reasoning & activity panel for a turn when enabled', () => {
    mockTurns.push({
      id: 'turn-1',
      userText: 'hi',
      assistantSource: '',
      assistantContent: { nodes: [{ children: [{ value: 'reply' }] }] },
      isStreaming: false,
      activity: emptyActivity()
    })

    renderMobilePage()

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

    renderMobilePage()

    expect(screen.queryByRole('heading', { name: /reasoning & activity/i })).toBeNull()
  })

  it('hides the voice button when Web Speech API is disabled in settings', () => {
    renderMobilePage()
    expect(screen.queryByRole('button', { name: /voice input/i })).toBeNull()
  })

  it('renders a disabled voice button when the browser does not expose Web Speech API', () => {
    mockSpeechState.visible = true
    renderMobilePage()
    expect(screen.getByRole('button', { name: /voice input unavailable/i })).toBeDisabled()
  })

  it('clears the input immediately once a prompt is accepted (issue #206)', () => {
    renderMobilePage()

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
    renderMobilePage()

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(/ask anything/i)
    fireEvent.change(textarea, { target: { value: 'Blocked message' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    expect(textarea.value).toBe('Blocked message')
  })

  it('disables sending while the agent is running', () => {
    mockChatState.isRunning = true
    renderMobilePage()

    expect(screen.getByRole('button', { name: 'Thinking…' })).toBeDisabled()
  })
})
