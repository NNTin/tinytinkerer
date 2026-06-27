// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FloatingWidgetChat + WidgetChatSurface compose the shared chat-surface hooks and
// presentational pieces. We mock those sibling source modules so the test exercises
// the floating window chrome (minimize/restore, host-mode messaging) and the
// surface wiring (send/stop/settings) without a live app or runtime. The hooks'
// own logic is unit-tested in surfaces/web-speech tests.

const mockAuthState = vi.hoisted(() => ({ token: null as string | null }))

const mockChatState = vi.hoisted(() => ({
  turns: [
    {
      id: 'turn-1',
      userText: 'hello',
      assistantContent: {
        nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hi there.' }] }]
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
  submitPrompt: vi.fn(() => true),
  rerunLastPrompt: vi.fn(),
  resetConversation: vi.fn(),
  cancelRetry: vi.fn(),
  stop: vi.fn()
}))

const mockSpeechState = vi.hoisted(() => ({
  visible: false,
  available: false,
  listening: false,
  error: null as string | null,
  toggle: vi.fn(() => Promise.resolve()),
  stop: vi.fn()
}))

vi.mock('../src/surfaces.js', async () => {
  const { useState } = await import('react')
  return {
    // Faithful stand-in for the shared composer hook: owns prompt state and the
    // submit → clear-on-accept behavior so the surface wiring can be exercised.
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
    useChatSurfaceController: () => ({
      isBooting: false,
      events: mockChatState.events,
      turns: mockChatState.turns,
      serverNameById: new Map<string, string>(),
      isRunning: mockChatState.isRunning,
      isRetryPending: false,
      submitLabel: mockChatState.isRunning ? 'Thinking…' : 'Send',
      isCoolingDown: mockChatState.isCoolingDown,
      submitPrompt: mockChatState.submitPrompt,
      rerunLastPrompt: mockChatState.rerunLastPrompt,
      canRerun: false,
      resetConversation: mockChatState.resetConversation,
      cancelRetry: mockChatState.cancelRetry,
      stop: mockChatState.stop
    }),
    useSettingsSurfaceController: () => ({ token: mockAuthState.token })
  }
})

vi.mock('../src/use-stick-to-bottom.js', () => ({
  useStickToBottom: () => ({
    scrollRef: { current: null },
    isPinned: true,
    showJumpButton: false,
    scrollToBottom: () => undefined
  })
}))

vi.mock('../src/conversation-empty-state.js', () => ({
  ConversationEmptyState: () => <div data-empty-state="true" />
}))

vi.mock('../src/turn-chrome.js', () => ({
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
    ) : null
}))

vi.mock('../src/jump-to-latest.js', () => ({
  JumpToLatestButton: ({ visible }: { visible: boolean }) =>
    visible ? (
      <button type="button" aria-label="Jump to latest">
        New messages
      </button>
    ) : null
}))

vi.mock('../src/human-prompt-composer-dock.js', () => ({
  HumanPromptComposerDock: () => null
}))

vi.mock('../src/lazy-browser-settings-modal.js', () => ({
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
    ) : null
}))

vi.mock('../src/hooks.js', () => ({
  useBrowserShellConfig: () => ({ theme: undefined })
}))

vi.mock('../src/shell-theme.js', () => ({
  shellThemeToCssVars: () => ({})
}))

import { FloatingWidgetChat } from '../src/widget-chat/floating-widget-chat.js'

const Loading = ({ error }: { error?: string }) => <div data-loading="true">{error}</div>

const renderStandalone = () =>
  render(
    <FloatingWidgetChat
      viewMode="standalone"
      storageKey="test:widget-layout"
      LoadingComponent={Loading}
    />
  )

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mockAuthState.token = null
  mockChatState.isRunning = false
  mockChatState.isCoolingDown = false
  mockChatState.submitPrompt.mockReturnValue(true)
  mockSpeechState.visible = false
  mockSpeechState.available = false
  mockSpeechState.listening = false
  mockSpeechState.error = null
})

describe('FloatingWidgetChat', () => {
  it('shows conversation-first layout with footer settings and sign-in actions', () => {
    renderStandalone()

    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minimize widget' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /voice input/i })).toBeNull()
  })

  it('renders a turn notice and final assistant answer in the same card', () => {
    renderStandalone()

    expect(screen.getByText('Recovered after a short wait.')).toBeInTheDocument()
    expect(screen.getByText('Hi there.')).toBeInTheDocument()
  })

  it('submits prompts through the shared chat store', async () => {
    renderStandalone()

    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText(
          'Ask something current, compare options, or continue the thread.'
        ),
        { target: { value: 'Tell me something current' } }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await Promise.resolve()
    })

    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('Tell me something current')
  })

  it('clears the input immediately once a prompt is accepted (issue #206)', () => {
    renderStandalone()

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      'Ask something current, compare options, or continue the thread.'
    )

    fireEvent.change(textarea, { target: { value: 'Next question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('Next question')
    expect(textarea.value).toBe('')
  })

  it('does not clear the input when the send is rejected', () => {
    mockChatState.submitPrompt.mockReturnValue(false)
    renderStandalone()

    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(
      'Ask something current, compare options, or continue the thread.'
    )

    fireEvent.change(textarea, { target: { value: 'Blocked message' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(textarea.value).toBe('Blocked message')
  })

  it('replaces send with a Stop button while the agent is running', () => {
    mockChatState.isRunning = true
    renderStandalone()

    const stopButton = screen.getByRole('button', { name: 'Stop generating' })
    expect(stopButton).not.toBeDisabled()
    fireEvent.click(stopButton)
    expect(mockChatState.stop).toHaveBeenCalledTimes(1)
  })

  it('opens settings from the footer trigger', () => {
    renderStandalone()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByText('Settings modal')).toBeInTheDocument()
  })

  it('renders a disabled voice button when Web Speech API is unavailable', () => {
    mockSpeechState.visible = true
    renderStandalone()
    expect(screen.getByRole('button', { name: /voice input unavailable/i })).toBeDisabled()
  })

  it('collapses to a launcher and restores in standalone mode', () => {
    renderStandalone()

    fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))
    expect(screen.getByRole('button', { name: 'Restore widget' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore widget' }))
    expect(screen.getByRole('button', { name: 'Minimize widget' })).toBeInTheDocument()
  })

  it('shows the shared minimize control in host mode and posts the minimized state', () => {
    const postMessageSpy = vi.fn()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      configurable: true
    })

    render(
      <FloatingWidgetChat
        viewMode="host"
        storageKey="test:widget-layout"
        LoadingComponent={Loading}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'tinytinkerer.widget.state', mode: 'minimized' },
      window.location.origin
    )
  })
})
