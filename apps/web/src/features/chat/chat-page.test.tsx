import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Mutable settings state — modified per test via vi.hoisted so the mock factory can close over it
const mockSettingsState = vi.hoisted(() => ({
  showThinkingTimeline: true,
  showToolActivity: true
}))

// Mutable auth state — modified per test to simulate signed-in / signed-out
const mockAuthState = vi.hoisted(() => ({
  token: null as string | null,
  clearToken: vi.fn(),
  setToken: vi.fn(),
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

vi.mock('../../stores/auth-store.js', () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}))

vi.mock('../../stores/settings-store.js', () => ({
  useSettingsStore: (selector: (s: typeof mockSettingsState) => unknown) => selector(mockSettingsState)
}))

vi.mock('../../services/auth.js', () => ({
  buildGitHubLoginUrl: () => null,
}))

vi.mock('../settings/settings-modal.js', () => ({
  SettingsModal: ({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) =>
    open ? (
      <div role="dialog" aria-label="Settings">
        <button type="button" aria-label="Close settings" onClick={() => onOpenChange(false)}>
          Close
        </button>
        <section aria-label="Auth">
          <h3>Auth</h3>
          <button type="button">Sign in with GitHub</button>
        </section>
      </div>
    ) : null,
}))

import { ChatPage } from './chat-page.js'

beforeAll(() => {
  // jsdom does not implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  // Reset to default (both panels visible, signed out) before each test
  mockSettingsState.showThinkingTimeline = true
  mockSettingsState.showToolActivity = true
  mockAuthState.token = null
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

describe('ChatPage composer auth entry point', () => {
  it('shows "Sign in" button in the composer when not authenticated', () => {
    mockAuthState.token = null
    render(<ChatPage />)
    expect(screen.getByRole('button', { name: /sign in with github/i })).not.toBeNull()
  })

  it('hides "Sign in" button from the composer when already authenticated', () => {
    mockAuthState.token = 'ghp_test_token'
    render(<ChatPage />)
    expect(screen.queryByRole('button', { name: /sign in with github/i })).toBeNull()
  })
})

describe('ChatPage settings modal', () => {
  it('modal is closed by default', () => {
    render(<ChatPage />)
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('opens the settings modal when the settings gear button is clicked', () => {
    render(<ChatPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).not.toBeNull()
  })

  it('modal contains auth controls', () => {
    render(<ChatPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('region', { name: /auth/i })).not.toBeNull()
    expect(within(dialog).getByRole('button', { name: /sign in with github/i })).not.toBeNull()
  })

  it('closes the modal when the close button is clicked', () => {
    render(<ChatPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('dialog', { name: 'Settings' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })
})
