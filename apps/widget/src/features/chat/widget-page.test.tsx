import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthState = vi.hoisted(() => ({
  token: null as string | null,
  setToken: vi.fn(),
  clearToken: vi.fn()
}))

const mockChatState = vi.hoisted(() => ({
  events: [
    {
      id: 'turn-1',
      userText: 'hello',
      assistantText: 'Hi there.',
      notice: {
        kind: 'rate-limit' as const,
        message: 'Recovered after a short wait.',
        level: 'warning' as const
      }
    }
  ],
  streamingText: '',
  isRunning: false,
  sendPrompt: vi.fn().mockResolvedValue(undefined),
  resetConversation: vi.fn(),
  initialize: vi.fn()
}))

const mockSettingsState = vi.hoisted(() => ({
  selectedModel: 'openai/gpt-4.1-mini',
  searchEnabled: true,
  setSelectedModel: vi.fn(),
  setSearchEnabled: vi.fn()
}))

const mockStatusState = vi.hoisted(() => ({
  status: {
    auth: { state: 'ready', detail: 'GitHub auth available' },
    models: { state: 'ready', detail: 'Models ready' },
    search: { state: 'degraded', detail: 'Search temporarily unavailable' }
  },
  refresh: vi.fn()
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  AssistantContent: ({ content, className }: { content: string; className?: string }) => (
    <div className={className}>{content}</div>
  ),
  buildTurns: () => mockChatState.events,
  formatCooldown: (ms: number) => `${Math.ceil(ms / 1000)}s`,
  startStatusPolling: vi.fn(() => () => undefined),
  SUPPORTED_MODELS: [{ id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }],
  useChatCooldown: () => ({ cooldownRemainingMs: 0, isCoolingDown: false }),
  useGitHubOAuth: () => ({
    canStartGitHubOAuth: true,
    startGitHubOAuth: vi.fn(),
    completeGitHubOAuthCallback: vi.fn()
  }),
  useGitHubUser: () => null,
  useGitHubModels: () => [{ id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }],
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
  useChatStore: Object.assign(
    (selector: (state: typeof mockChatState) => unknown) => selector(mockChatState),
    {
      getState: () => mockChatState
    }
  ),
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) => selector(mockSettingsState),
  useStatusStore: (selector: (state: typeof mockStatusState) => unknown) => selector(mockStatusState)
}))

import { WidgetPage } from './widget-page.js'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthState.token = null
  mockSettingsState.searchEnabled = true
  mockStatusState.status.search.state = 'degraded'
  mockStatusState.status.search.detail = 'Search temporarily unavailable'
})

describe('WidgetPage', () => {
  it('disables search controls when the service is unavailable', () => {
    render(<WidgetPage />)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeDisabled()
    expect(screen.getByText('Search temporarily unavailable')).toBeInTheDocument()
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
        screen.getByPlaceholderText('Ask something current, compare options, or continue the thread.'),
        {
          target: { value: 'Tell me something current' }
        }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Send' }))
      await Promise.resolve()
    })

    expect(mockChatState.sendPrompt).toHaveBeenCalledWith('Tell me something current')
  })
})
