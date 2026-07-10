// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// FloatingChatSurface is the compact chat body shared by every floating layout
// (the widget app and the canvas app's overlay). We mock the sibling source
// modules so the test exercises the body wiring without a live app, mirroring
// docked-chat-surface.test.tsx's mocking style.

const mockChatState = vi.hoisted(() => ({
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
    }),
    useSettingsSurfaceController: () => ({
      token: null
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

vi.mock('../src/lazy-browser-settings-modal.js', () => ({
  LazySettingsPanel: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Settings" /> : null
}))

import { FloatingChatSurface } from '../src/chat-shell/floating-chat-surface.js'

const Loading = ({ error }: { error?: string }) => <div data-loading="true">{error}</div>

const turnWithActivity = {
  id: 'turn-1',
  userText: 'hello',
  assistantContent: {
    nodes: [{ children: [{ value: 'hi there' }] }]
  },
  activity: { reasoningText: 'thinking...', items: [] as [] }
}

afterEach(() => {
  cleanup()
})

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockChatState.turns = []
  mockChatState.showReasoningActivity = true
  mockChatState.isRunning = false
  mockChatState.isCoolingDown = false
  mockChatState.submitPrompt.mockReturnValue(true)
  mockSpeechState.visible = false
})

describe('FloatingChatSurface', () => {
  it('renders the Reasoning & activity panel for a turn when the setting is enabled', () => {
    mockChatState.turns = [turnWithActivity]
    mockChatState.showReasoningActivity = true
    render(<FloatingChatSurface LoadingComponent={Loading} />)
    expect(screen.getByRole('heading', { name: /reasoning & activity/i })).toBeInTheDocument()
  })

  it('does not render the Reasoning & activity panel when the setting is disabled', () => {
    mockChatState.turns = [turnWithActivity]
    mockChatState.showReasoningActivity = false
    render(<FloatingChatSurface LoadingComponent={Loading} />)
    expect(screen.queryByRole('heading', { name: /reasoning & activity/i })).toBeNull()
  })
})
