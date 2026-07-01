// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// DockedChatSurface is the full-height docked body shared by the web + mobile shells
// (the merge of the former apps/web chat-page + apps/mobile mobile-page). We mock
// the sibling source modules so the test exercises the body wiring + variant chrome
// without a live app.

const mockChatState = vi.hoisted(() => ({
  token: null as string | null,
  turns: [] as Array<{
    id: string
    userText: string
    assistantContent: { nodes: Array<{ children?: Array<{ value?: string }> }> } | null
    activity: { reasoningText: string; items: [] }
    notice?: { message: string; level?: 'info' | 'warning' | 'error' }
  }>,
  showReasoningActivity: true,
  isRunning: false,
  isCoolingDown: false,
  submitPrompt: vi.fn(() => true),
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
    useChatComposer: (submitPrompt: (prompt: string) => boolean) => {
      const [prompt, setPrompt] = useState('')
      const handleSubmit = (): boolean => {
        const accepted = submitPrompt(prompt)
        if (accepted) setPrompt('')
        return accepted
      }
      return { prompt, setPrompt, speech: mockSpeechState, handleSubmit }
    },
    useChatSurfaceController: () => ({
      isBooting: false,
      events: [],
      token: mockChatState.token,
      turns: mockChatState.turns,
      serverNameById: new Map<string, string>(),
      resolveActivitySummarizer: () => undefined,
      isRunning: mockChatState.isRunning,
      isRetryPending: false,
      showReasoningActivity: mockChatState.showReasoningActivity,
      submitLabel: mockChatState.isRunning ? 'Thinking…' : 'Send',
      isCoolingDown: mockChatState.isCoolingDown,
      submitPrompt: mockChatState.submitPrompt,
      rerunLastPrompt: vi.fn(),
      canRerun: false,
      resetConversation: mockChatState.resetConversation,
      cancelRetry: mockChatState.cancelRetry,
      stop: mockChatState.stop
    })
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

vi.mock('../src/turn-activity-panel.js', () => ({
  TurnActivityPanel: () => (
    <section aria-label="Reasoning and activity">
      <h3>Reasoning &amp; activity</h3>
    </section>
  )
}))

vi.mock('../src/jump-to-latest.js', () => ({
  JumpToLatestButton: () => null
}))

vi.mock('../src/human-prompt-composer-dock.js', () => ({
  HumanPromptComposerDock: () => null
}))

vi.mock('../src/context-gauge.js', () => ({
  ContextGaugeSlot: () => null
}))

vi.mock('../src/lazy-browser-settings-modal.js', () => ({
  LazyBrowserSettingsModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Settings" /> : null
}))

import { DockedChatSurface } from '../src/chat-shell/docked-chat-surface.js'

const Loading = ({ error }: { error?: string }) => <div data-loading="true">{error}</div>

afterEach(() => {
  cleanup()
})

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockChatState.token = null
  mockChatState.turns = []
  mockChatState.showReasoningActivity = true
  mockChatState.isRunning = false
  mockChatState.isCoolingDown = false
  mockChatState.submitPrompt.mockReturnValue(true)
  mockSpeechState.visible = false
})

describe('DockedChatSurface', () => {
  it('renders composer actions and the sign-in entry when unauthenticated', () => {
    render(<DockedChatSurface LoadingComponent={Loading} />)
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset conversation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with github/i })).toBeInTheDocument()
  })

  it('clears the input once a prompt is accepted, keeps it when rejected (issue #206)', () => {
    const { rerender } = render(<DockedChatSurface LoadingComponent={Loading} />)
    const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>(/ask anything/i)
    fireEvent.change(textarea, { target: { value: 'What is new?' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)
    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('What is new?')
    expect(textarea.value).toBe('')

    mockChatState.submitPrompt.mockReturnValue(false)
    rerender(<DockedChatSurface LoadingComponent={Loading} />)
    const next = screen.getByPlaceholderText<HTMLTextAreaElement>(/ask anything/i)
    fireEvent.change(next, { target: { value: 'Blocked' } })
    fireEvent.submit(next.closest('form') as HTMLFormElement)
    expect(next.value).toBe('Blocked')
  })

  it('replaces send with Stop while running and resets on demand', () => {
    mockChatState.isRunning = true
    render(<DockedChatSurface LoadingComponent={Loading} />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }))
    expect(mockChatState.stop).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reset conversation' }))
    expect(mockChatState.resetConversation).toHaveBeenCalledTimes(1)
  })

  it('opens the settings modal from the gear button', async () => {
    render(<DockedChatSurface LoadingComponent={Loading} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('renders the inspector slot only when provided', () => {
    const { rerender } = render(<DockedChatSurface LoadingComponent={Loading} />)
    expect(screen.queryByTestId('inspector')).toBeNull()
    rerender(
      <DockedChatSurface
        LoadingComponent={Loading}
        inspectorSlot={<div data-testid="inspector" />}
      />
    )
    expect(screen.getByTestId('inspector')).toBeInTheDocument()
  })

  it('renders the install slot when provided', () => {
    render(
      <DockedChatSurface LoadingComponent={Loading} installSlot={<div data-testid="install" />} />
    )
    expect(screen.getByTestId('install')).toBeInTheDocument()
  })

  it('shows the turn-count badge only in the mobile variant', () => {
    const { rerender } = render(
      <DockedChatSurface LoadingComponent={Loading} sizeVariant="comfortable" />
    )
    expect(screen.queryByText(/0 turns/i)).toBeNull()
    rerender(<DockedChatSurface LoadingComponent={Loading} sizeVariant="mobile" />)
    expect(screen.getByText(/0 turns/i)).toBeInTheDocument()
  })
})
