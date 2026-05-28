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
  submitPrompt: vi.fn().mockResolvedValue(true),
  resetConversation: vi.fn(),
  cancelRetry: vi.fn()
}))

const mockSettingsState = vi.hoisted(() => ({
  effectiveStatus: {
    auth: { state: 'ready', detail: 'GitHub auth available' },
    models: { state: 'ready', detail: 'Models ready' },
    search: {
      state: 'degraded',
      detail: 'Search temporarily unavailable'
    }
  },
  selectedModel: 'openai/gpt-4.1-mini',
  searchEnabled: true,
  setSelectedModel: vi.fn(),
  setSearchEnabled: vi.fn(),
  setShowThinkingTimeline: vi.fn(),
  setShowToolActivity: vi.fn(),
  setShowCodeBlockFullscreenButton: vi.fn(),
  showThinkingTimeline: true,
  showToolActivity: true,
  showCodeBlockFullscreenButton: true
}))

vi.mock('@tinytinkerer/app-browser', () => ({
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
  McpServerList: () => null,
  TINYTINKERER_BRAND_ASSET_URLS: {
    icon192: '/brand/icon-192.png'
  },
  useChatSurfaceController: () => ({
    isBooting: false,
    events: mockChatState.events,
    token: mockAuthState.token,
    turns: mockChatState.turns,
    timeline: [],
    toolEvents: [],
    isRunning: mockChatState.isRunning,
    isRetryPending: false,
    showThinkingTimeline: true,
    showToolActivity: true,
    cooldownRemainingMs: 0,
    isCoolingDown: false,
    submitLabel: mockChatState.isRunning ? 'Thinking…' : 'Send',
    submitPrompt: mockChatState.submitPrompt,
    resetConversation: mockChatState.resetConversation,
    cancelRetry: mockChatState.cancelRetry
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
    selectedModel: mockSettingsState.selectedModel,
    setSelectedModel: mockSettingsState.setSelectedModel,
    searchEnabled: mockSettingsState.searchEnabled,
    setSearchEnabled: mockSettingsState.setSearchEnabled,
    showThinkingTimeline: mockSettingsState.showThinkingTimeline,
    setShowThinkingTimeline: mockSettingsState.setShowThinkingTimeline,
    showToolActivity: mockSettingsState.showToolActivity,
    setShowToolActivity: mockSettingsState.setShowToolActivity,
    showCodeBlockFullscreenButton: mockSettingsState.showCodeBlockFullscreenButton,
    setShowCodeBlockFullscreenButton: mockSettingsState.setShowCodeBlockFullscreenButton,
    searchUnavailable: mockSettingsState.effectiveStatus.search.state !== 'ready',
    mcpServers: [],
    mcpDiscovery: {},
    addMcpServer: vi.fn(),
    updateMcpServer: vi.fn(),
    removeMcpServer: vi.fn(),
    setMcpServerEnabled: vi.fn(),
    refreshMcpServer: vi.fn()
  })
}))

import { WidgetPage } from './widget-page.js'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/widget/')
  mockAuthState.token = null
  mockSettingsState.searchEnabled = true
  mockSettingsState.effectiveStatus.search.state = 'degraded'
  mockSettingsState.effectiveStatus.search.detail = 'Search temporarily unavailable'
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

    expect(mockChatState.submitPrompt).toHaveBeenCalledWith('Tell me something current')
  })

  it('collapses to a launcher and restores in standalone mode', () => {
    render(<WidgetPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))

    expect(screen.getByRole('button', { name: 'Restore widget' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore widget' }))

    expect(screen.getByRole('button', { name: 'Minimize' })).toBeInTheDocument()
  })

  it('posts minimized state changes to the host when rendered in host mode', () => {
    window.history.replaceState({}, '', '/widget/?view=host')
    const postMessageSpy = vi.fn()
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageSpy },
      configurable: true
    })

    render(<WidgetPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))

    expect(postMessageSpy).toHaveBeenLastCalledWith(
      {
        type: 'tinytinkerer.widget.state',
        mode: 'minimized'
      },
      window.location.origin
    )
  })
})
