import { render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable settings state — modified per test via vi.hoisted so the mock factory can close over it
const mockSettingsState = vi.hoisted(() => ({
  showThinkingTimeline: true,
  showToolActivity: true
}))

// Stub zustand store — provide minimal shape ChatPage reads
vi.mock('../../stores/chat-store.js', () => {
  const state = {
    events: [],
    streamingText: '',
    isRunning: false,
    isRetryPending: false,
    cooldownUntil: null,
    sendPrompt: vi.fn(),
    resetConversation: vi.fn(),
    cancelRetry: vi.fn(),
  }
  const useChatStore = (selector: (s: typeof state) => unknown) => selector(state)
  useChatStore.getState = () => ({ initialize: vi.fn().mockResolvedValue(undefined) })
  return { useChatStore }
})

vi.mock('../../stores/auth-store.js', () => {
  const state = { token: null, clearToken: vi.fn(), setToken: vi.fn() }
  return { useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) }
})

vi.mock('../../stores/settings-store.js', () => ({
  useSettingsStore: (selector: (s: typeof mockSettingsState) => unknown) => selector(mockSettingsState)
}))

vi.mock('../../services/auth.js', () => ({
  buildGitHubLoginUrl: () => null,
}))

vi.mock('../settings/settings-modal.js', () => ({
  SettingsModal: () => null,
}))

import { ChatPage } from './chat-page.js'

beforeAll(() => {
  // jsdom does not implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  // Reset to default (both panels visible) before each test
  mockSettingsState.showThinkingTimeline = true
  mockSettingsState.showToolActivity = true
})

describe('ChatPage layout', () => {
  it('bounds the page to viewport height', () => {
    const { container } = render(<ChatPage />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-screen')
    expect(root.className).not.toContain('min-h-screen')
  })

  it('gives the conversation section overflow-y-auto for in-place scrolling', () => {
    const { container } = render(<ChatPage />)
    const scrollDiv = container.querySelector('section div.overflow-y-auto')
    expect(scrollDiv).not.toBeNull()
  })

  it('gives main overflow-hidden to contain layout within viewport', () => {
    const { container } = render(<ChatPage />)
    const main = container.querySelector('main')
    expect(main?.className).toContain('overflow-hidden')
  })

  it('does not render a sticky top bar — navigation was moved into the composer', () => {
    const { container } = render(<ChatPage />)
    // The previous top-bar rendered a <header> element; it has been removed
    expect(container.querySelector('header')).toBeNull()
  })
})

describe('ChatPage secondary panel conditional rendering', () => {
  it('shows thinking timeline section when showThinkingTimeline is true', () => {
    mockSettingsState.showThinkingTimeline = true
    render(<ChatPage />)
    expect(screen.getByRole('heading', { name: /thinking/i })).not.toBeNull()
  })

  it('hides thinking timeline section when showThinkingTimeline is false', () => {
    mockSettingsState.showThinkingTimeline = false
    render(<ChatPage />)
    expect(screen.queryByRole('heading', { name: /thinking/i })).toBeNull()
  })

  it('shows tool activity section when showToolActivity is true', () => {
    mockSettingsState.showToolActivity = true
    render(<ChatPage />)
    expect(screen.getByRole('heading', { name: /tools/i })).not.toBeNull()
  })

  it('hides tool activity section when showToolActivity is false', () => {
    mockSettingsState.showToolActivity = false
    render(<ChatPage />)
    expect(screen.queryByRole('heading', { name: /tools/i })).toBeNull()
  })

  it('shows only the conversation and composer when both secondary panels are disabled', () => {
    mockSettingsState.showThinkingTimeline = false
    mockSettingsState.showToolActivity = false
    const { container } = render(<ChatPage />)
    // Two sections: conversation + composer (form)
    const sections = container.querySelectorAll('section')
    expect(sections).toHaveLength(1) // only the conversation <section>
    expect(container.querySelector('form')).not.toBeNull()
  })
})
