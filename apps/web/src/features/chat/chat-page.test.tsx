import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  events: [] as any[],
  streamingText: '',
  isRunning: false,
  isRetryPending: false,
  cooldownUntil: undefined as string | undefined,
  sendPrompt: vi.fn(),
  resetConversation: vi.fn(),
  cancelRetry: vi.fn()
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  buildCurrentTimeline: () => [],
  buildTurns: () => mockTurns,
  canStartGitHubOAuth: () => true,
  startGitHubOAuth: vi.fn(),
  startStatusPolling: vi.fn(() => () => undefined),
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
  useChatStore: (selector: (state: typeof mockChatState) => unknown) => selector(mockChatState),
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) => selector(mockSettingsState),
  useStatusStore: (selector: (state: typeof mockStatusState) => unknown) => selector(mockStatusState),
  SUPPORTED_MODELS: [{ id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }]
}))

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
  mockSettingsState.showThinkingTimeline = true
  mockSettingsState.showToolActivity = true
  mockAuthState.token = null
  mockChatState.events = []
  mockChatState.streamingText = ''
  mockChatState.isRunning = false
  mockChatState.isRetryPending = false
  mockChatState.cooldownUntil = undefined
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

describe('ChatPage secondary panel conditional rendering', () => {
  it('shows thinking timeline section when showThinkingTimeline is true', () => {
    renderChatPage()
    expect(screen.getByRole('heading', { name: /thinking/i })).not.toBeNull()
  })

  it('hides thinking timeline section when showThinkingTimeline is false', () => {
    mockSettingsState.showThinkingTimeline = false
    renderChatPage()
    expect(screen.queryByRole('heading', { name: /thinking/i })).toBeNull()
  })

  it('shows tool history section when showToolActivity is true', () => {
    renderChatPage()
    expect(screen.getByRole('heading', { name: /tool history/i })).not.toBeNull()
  })

  it('hides tool history section when showToolActivity is false', () => {
    mockSettingsState.showToolActivity = false
    renderChatPage()
    expect(screen.queryByRole('heading', { name: /tool history/i })).toBeNull()
  })

  it('shows only the conversation and composer when both secondary panels are disabled', () => {
    mockSettingsState.showThinkingTimeline = false
    mockSettingsState.showToolActivity = false
    const { container } = renderChatPage()
    const sections = container.querySelectorAll('section')
    expect(sections).toHaveLength(1)
    expect(container.querySelector('form')).not.toBeNull()
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

describe('ChatPage settings modal', () => {
  it('modal is closed by default', () => {
    renderChatPage()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('opens the settings modal when the settings gear button is clicked', () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).not.toBeNull()
  })

  it('shows auth, models, search, and interface sections with relocated status details', async () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
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

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    const authRegion = within(dialog).getByRole('region', { name: 'Auth' })
    expect(await within(authRegion).findByRole('button', { name: /sign in with github/i })).not.toBeNull()
    expect(within(authRegion).getByRole('button', { name: /use a personal access token instead/i })).not.toBeNull()
  })

  it('closes the modal when the close button is clicked', () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('disables search controls when the service is unavailable', () => {
    renderChatPage()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
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
      assistantText: 'Hi there.',
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
