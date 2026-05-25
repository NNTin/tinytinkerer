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

const mockStatusState = vi.hoisted(() => ({
  status: {
    auth: { state: 'ready', detail: 'GitHub auth available' },
    models: { state: 'degraded', detail: 'Model responses are slower than usual' },
    search: { state: 'offline', detail: 'Search temporarily unavailable', error: 'Upstream timeout' }
  },
  refresh: vi.fn()
}))

const mockTurns = vi.hoisted(() => [] as Array<{
  id: string
  userText: string
  assistantText: string
  notice?: {
    kind: 'system' | 'error' | 'rate-limit'
    message: string
    level?: 'info' | 'warning' | 'error'
  }
}>)

const mockChatState = vi.hoisted(() => ({
  events: [] as MockChatEvent[],
  streamingText: '',
  isRunning: false,
  isRetryPending: false,
  cooldownUntil: undefined as string | undefined,
  sendPrompt: vi.fn(),
  resetConversation: vi.fn(),
  cancelRetry: vi.fn()
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  AssistantContent: ({ content, className }: { content: string; className?: string }) => (
    <div className={className}>{content}</div>
  ),
  buildCurrentTimeline: () => [],
  buildTurns: () => mockTurns,
  formatCooldown: (ms: number) => `${Math.ceil(ms / 1000)}s`,
  startStatusPolling: vi.fn(() => () => undefined),
  useChatCooldown: () => ({ cooldownRemainingMs: 0, isCoolingDown: false }),
  useGitHubOAuth: () => ({
    canStartGitHubOAuth: true,
    startGitHubOAuth: vi.fn(),
    completeGitHubOAuthCallback: vi.fn()
  }),
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
  useChatStore: (selector: (state: typeof mockChatState) => unknown) => selector(mockChatState),
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) => selector(mockSettingsState),
  useStatusStore: (selector: (state: typeof mockStatusState) => unknown) => selector(mockStatusState),
  SUPPORTED_MODELS: [{ id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }]
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
  mockChatState.streamingText = ''
  mockChatState.isRunning = false
  mockChatState.isRetryPending = false
  mockChatState.cooldownUntil = undefined
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
