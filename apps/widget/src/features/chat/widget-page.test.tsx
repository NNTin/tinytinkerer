import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthState = vi.hoisted(() => ({
  token: null as string | null,
  setToken: vi.fn(),
  clearToken: vi.fn()
}))

const mockChatState = vi.hoisted(() => ({
  turns: [
    {
      id: 'turn-1',
      userText: 'hello',
      assistantSource: 'Hi there.',
      assistantContent: {
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Hi there.' }]
          }
        ]
      },
      isStreaming: false,
      notice: {
        kind: 'rate-limit' as const,
        message: 'Recovered after a short wait.',
        level: 'warning' as const
      }
    }
  ],
  events: [] as Array<{ id: string; type: string }>,
  isRunning: false,
  isCoolingDown: false,
  // submitPrompt returns the accept/reject decision synchronously (issue #206).
  submitPrompt: vi.fn(() => true),
  rerunLastPrompt: vi.fn(),
  resetConversation: vi.fn(),
  cancelRetry: vi.fn(),
  stop: vi.fn()
}))

const mockSettingsState = vi.hoisted(() => ({
  effectiveStatus: {
    auth: { state: 'ready', detail: 'GitHub auth available' },
    models: { state: 'ready', detail: 'Models ready' }
  },
  selectedModel: 'openai/gpt-4.1-mini',
  webSpeechEnabled: false,
  setSelectedModel: vi.fn(),
  setWebSpeechEnabled: vi.fn(),
  setShowReasoningActivity: vi.fn(),
  setShowCodeBlockFullscreenButton: vi.fn(),
  showReasoningActivity: true,
  showCodeBlockFullscreenButton: true
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
    ContextGaugeSlot: () => null,
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
    LazySettingsPanel: ({
      open,
      onOpenChange
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      presentation?: 'modal' | 'inline'
    }) =>
      open ? (
        <div>
          <span>Settings modal</span>
          <button type="button" aria-label="Close settings" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </div>
      ) : null,
    PermissionModal: () => null,
    TurnChrome: ({
      turn
    }: {
      turn: {
        id: string
        assistantContent: { nodes: Array<{ children?: Array<{ value?: string }> }> } | null
      }
    }) =>
      turn.assistantContent ? (
        <div data-turn-id={turn.id}>{turn.assistantContent.nodes[0]?.children?.[0]?.value}</div>
      ) : null,
    ConversationEmptyState: () => <div data-empty-state="true" />,
    JumpToLatestButton: ({ visible }: { visible: boolean }) =>
      visible ? (
        <button type="button" aria-label="Jump to latest">
          New messages
        </button>
      ) : null,
    useStickToBottom: () => ({
      scrollRef: { current: null },
      isPinned: true,
      showJumpButton: false,
      scrollToBottom: () => undefined
    }),
    useBrowserShellConfig: () => ({ theme: undefined }),
    shellThemeToCssVars: () => ({}),
    TINYTINKERER_BRAND_ASSET_URLS: {
      icon192: '/brand/icon-192.png'
    },
    useWebSpeechInput: () => mockSpeechState,
    useChatSurfaceController: () => ({
      isBooting: false,
      events: mockChatState.events,
      token: mockAuthState.token,
      turns: mockChatState.turns,
      serverNameById: new Map<string, string>(),
      timeline: [],
      toolEvents: [],
      isRunning: mockChatState.isRunning,
      isRetryPending: false,
      showReasoningActivity: true,
      cooldownRemainingMs: 0,
      isCoolingDown: mockChatState.isCoolingDown,
      submitLabel: mockChatState.isRunning ? 'Thinking…' : 'Send',
      submitPrompt: mockChatState.submitPrompt,
      rerunLastPrompt: mockChatState.rerunLastPrompt,
      canRerun: false,
      resetConversation: mockChatState.resetConversation,
      cancelRetry: mockChatState.cancelRetry,
      stop: mockChatState.stop
    }),
    useSettingsSurfaceController: () => ({
      effectiveStatus: mockSettingsState.effectiveStatus,
      refreshStatus: vi.fn(),
      token: mockAuthState.token,
      clearToken: mockAuthState.clearToken,
      setToken: mockAuthState.setToken,
      canStartGitHubOAuth: true,
      startGitHubOAuth: vi.fn(),
      user: null,
      models: [{ id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }],
      isRefreshingModels: false,
      modelsRefreshError: null,
      refreshModels: vi.fn(),
      selectedModel: mockSettingsState.selectedModel,
      setSelectedModel: mockSettingsState.setSelectedModel,
      webSpeechEnabled: mockSettingsState.webSpeechEnabled,
      setWebSpeechEnabled: mockSettingsState.setWebSpeechEnabled,
      showReasoningActivity: mockSettingsState.showReasoningActivity,
      setShowReasoningActivity: mockSettingsState.setShowReasoningActivity,
      showCodeBlockFullscreenButton: mockSettingsState.showCodeBlockFullscreenButton,
      setShowCodeBlockFullscreenButton: mockSettingsState.setShowCodeBlockFullscreenButton,
      mcpServers: [],
      mcpDiscovery: {},
      addMcpServer: vi.fn(),
      updateMcpServer: vi.fn(),
      removeMcpServer: vi.fn(),
      setMcpServerEnabled: vi.fn(),
      refreshMcpServer: vi.fn(),
      telemetryEnabled: false,
      setTelemetryEnabled: vi.fn()
    })
  }
})

import { WidgetPage } from './widget-page.js'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/widget/')
  mockAuthState.token = null
  mockChatState.isRunning = false
  mockChatState.isCoolingDown = false
  mockChatState.submitPrompt.mockReturnValue(true)
  mockSettingsState.webSpeechEnabled = false
  mockSpeechState.visible = false
  mockSpeechState.available = false
  mockSpeechState.listening = false
  mockSpeechState.error = null
  mockSpeechState.toggle.mockClear()
  mockSpeechState.stop.mockClear()
})

describe('WidgetPage', () => {
  it('shows conversation-first layout with footer settings and sign-in actions', () => {
    render(<WidgetPage />)

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minimize widget' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText('MCP Servers')).toBeNull()
    expect(screen.queryByText('Embedded Workspace')).toBeNull()
    expect(screen.queryByText('tinytinkerer widget')).toBeNull()
    expect(screen.queryByRole('button', { name: /voice input/i })).toBeNull()
  })

  it('renders a turn notice and final assistant answer in the same card', () => {
    render(<WidgetPage />)

    expect(screen.getByText('Recovered after a short wait.')).toBeInTheDocument()
    expect(screen.getByText('Hi there.')).toBeInTheDocument()
  })

  it('submits prompts through the shared chat store', async () => {
    render(<WidgetPage />)

    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText(
          'Ask something current, compare options, or continue the thread.'
        ),
        {
          target: { value: 'Tell me something current' }
        }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await Promise.resolve()
    })

    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('Tell me something current')
  })

  it('clears the input immediately once a prompt is accepted (issue #206)', () => {
    render(<WidgetPage />)

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      'Ask something current, compare options, or continue the thread.'
    )

    fireEvent.change(textarea, { target: { value: 'Next question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    // submitPrompt is synchronous and returns true, so the textarea is cleared
    // without waiting for the backend response to resolve.
    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('Next question')
    expect(textarea.value).toBe('')
  })

  it('does not clear the input when the send is rejected', () => {
    mockChatState.submitPrompt.mockReturnValue(false)
    render(<WidgetPage />)

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      'Ask something current, compare options, or continue the thread.'
    )

    fireEvent.change(textarea, { target: { value: 'Blocked message' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(textarea.value).toBe('Blocked message')
  })

  it('replaces send with a Stop button while the agent is running', () => {
    mockChatState.isRunning = true
    render(<WidgetPage />)

    const stopButton = screen.getByRole('button', { name: 'Stop generating' })
    expect(stopButton).not.toBeDisabled()
    fireEvent.click(stopButton)
    expect(mockChatState.stop).toHaveBeenCalledTimes(1)
  })

  it('opens settings from the footer trigger', () => {
    render(<WidgetPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByText('Settings modal')).toBeInTheDocument()
  })

  it('renders a disabled voice button when Web Speech API is unavailable', () => {
    mockSpeechState.visible = true
    render(<WidgetPage />)
    expect(screen.getByRole('button', { name: /voice input unavailable/i })).toBeDisabled()
  })

  it('collapses to a launcher and restores in standalone mode', () => {
    render(<WidgetPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))

    expect(screen.getByRole('button', { name: 'Restore widget' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore widget' }))

    expect(screen.getByRole('button', { name: 'Minimize widget' })).toBeInTheDocument()
  })

  it('shows the shared minimize control in host mode and posts the minimized state', () => {
    window.history.replaceState({}, '', '/widget/?view=host')
    const postMessageSpy = vi.fn()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      configurable: true
    })

    render(<WidgetPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        type: 'tinytinkerer.widget.state',
        mode: 'minimized'
      },
      window.location.origin
    )
  })
})
