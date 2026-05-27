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
  showThinkingTimeline: true,
  showToolActivity: true,
  initialize: vi.fn(),
  setSelectedModel: vi.fn(),
  setSearchEnabled: vi.fn(),
  setShowThinkingTimeline: vi.fn(),
  setShowToolActivity: vi.fn()
}))

const mockAuthState = vi.hoisted(() => ({
  token: null as string | null,
  clearToken: vi.fn(),
  setToken: vi.fn(),
  initialize: vi.fn()
}))

const mockTurns = vi.hoisted(() => [] as Array<{
  id: string
  userText: string
  assistantSource: string
  assistantContent: { nodes: unknown[] } | null
  isStreaming: boolean
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

vi.mock('@tinytinkerer/app-browser', () => ({
  AssistantContent: ({
    content,
    className
  }: {
    content: { nodes: Array<{ children?: Array<{ value?: string }> }> }
    className?: string
  }) => (
    <div className={className}>{content.nodes[0]?.children?.[0]?.value}</div>
  ),
  useChatSurfaceController: () => ({
    events: mockChatState.events,
    token: mockAuthState.token,
    turns: mockTurns,
    timeline: [],
    toolEvents: [],
    isRunning: mockChatState.isRunning,
    isRetryPending: mockChatState.isRetryPending,
    showThinkingTimeline: mockSettingsState.showThinkingTimeline,
    showToolActivity: mockSettingsState.showToolActivity,
    cooldownRemainingMs: 0,
    isCoolingDown: false,
    submitLabel: mockChatState.isRunning ? 'Thinking…' : 'Send',
    submitPrompt: mockChatState.submitPrompt,
    resetConversation: mockChatState.resetConversation,
    cancelRetry: mockChatState.cancelRetry
  }),
  BrowserSettingsModal: () => null
}))

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
  mockSettingsState.showThinkingTimeline = true
  mockSettingsState.showToolActivity = true
  mockAuthState.token = null
  mockChatState.events = []
  mockChatState.isRunning = false
  mockChatState.isRetryPending = false
  mockChatState.cooldownUntil = undefined
  mockChatState.submitPrompt.mockClear()
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
})
