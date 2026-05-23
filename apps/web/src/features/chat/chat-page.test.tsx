import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../stores/settings-store.js', () => {
  const state = { showThinkingTimeline: true, showToolActivity: true }
  return { useSettingsStore: (selector: (s: typeof state) => unknown) => selector(state) }
})

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

describe('ChatPage conversation panel scrolling', () => {
  it('bounds the page to viewport height', () => {
    const { container } = render(<ChatPage />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('h-screen')
    expect(root.className).not.toContain('min-h-screen')
  })

  it('gives the conversation section overflow-y-auto for in-place scrolling', () => {
    const { container } = render(<ChatPage />)
    // The scrollable inner div sits inside the conversation <section>
    const scrollDiv = container.querySelector('section div.overflow-y-auto')
    expect(scrollDiv).not.toBeNull()
  })

  it('gives main overflow-hidden to contain layout within viewport', () => {
    const { container } = render(<ChatPage />)
    const main = container.querySelector('main')
    expect(main?.className).toContain('overflow-hidden')
  })
})
