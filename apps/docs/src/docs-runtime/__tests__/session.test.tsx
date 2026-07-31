/**
 * The supported session/conversation service #472 consumes (issue #479).
 *
 * Driven against a real `BrowserApp` and a real `AppBrowserProvider` — the same
 * arrangement the tool-picker suite uses — so what is asserted is the facade
 * over the genuine chat store, not a re-description of it. Only the store's
 * async actions are replaced, because those persist through Dexie and this
 * environment has no IndexedDB; what the facade does with them is the point.
 */
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AppBrowserProvider, createBrowserApp, type BrowserApp } from '@tinytinkerer/app-browser'
import { useDocsAssistantSession } from '../session'

const beginDocsProductSignIn = vi.hoisted(() => vi.fn())
vi.mock('../product-sign-in', () => ({ beginDocsProductSignIn }))

const actions = {
  selectConversation: vi.fn(async () => {}),
  startNewConversation: vi.fn(async () => {}),
  deleteConversation: vi.fn(async () => {}),
  resetConversation: vi.fn(async () => {})
}

const slice = (id: string, title: string, isRunning = false) => ({
  id,
  title,
  events: [],
  isRunning,
  isRetryPending: false,
  eventsLoaded: true
})

const assistantApp = (): BrowserApp => {
  const app = createBrowserApp({ storageNamespace: 'tinytinkerer-docs-assistant-test' })
  app.stores.chat.setState({
    conversationId: 'conv-b',
    conversations: {
      'conv-a': slice('conv-a', 'Hosting questions'),
      'conv-b': slice('conv-b', 'Plugin tools', true)
    },
    // Most-recently-updated first — the order the facade must preserve.
    conversationOrder: ['conv-b', 'conv-a'],
    ...actions
  })
  return app
}

const renderSession = (app: BrowserApp) =>
  renderHook(() => useDocsAssistantSession(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppBrowserProvider app={app}>{children}</AppBrowserProvider>
    )
  })

describe('useDocsAssistantSession', () => {
  it('exposes the assistant conversations in the store’s own order', () => {
    const { result } = renderSession(assistantApp())

    expect(result.current.conversations).toEqual([
      { id: 'conv-b', title: 'Plugin tools', isRunning: true },
      { id: 'conv-a', title: 'Hosting questions', isRunning: false }
    ])
    expect(result.current.activeConversationId).toBe('conv-b')
  })

  it('forwards selection, creation, and deletion to the one assistant store', async () => {
    const { result } = renderSession(assistantApp())

    await act(async () => {
      await result.current.selectConversation('conv-a')
      await result.current.startNewConversation()
      await result.current.deleteConversation('conv-a')
    })

    expect(actions.selectConversation).toHaveBeenCalledWith('conv-a')
    expect(actions.startNewConversation).toHaveBeenCalled()
    expect(actions.deleteConversation).toHaveBeenCalledWith('conv-a')
  })

  it('resets the active conversation in place, never the page', async () => {
    const app = assistantApp()
    const reload = vi.fn()
    const deleteDatabase = vi.fn()
    vi.stubGlobal('indexedDB', { deleteDatabase })
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload }
    })

    const { result } = renderSession(app)
    await act(async () => {
      await result.current.resetActiveConversation()
    })

    // The live labs delete their database and reload; a site-wide assistant must
    // do neither — that would reload the documentation out from under the reader
    // and take consent, authentication input and settings with it.
    expect(actions.resetConversation).toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(deleteDatabase).not.toHaveBeenCalled()

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    vi.unstubAllGlobals()
  })

  it('reports anonymous use as a normal state and offers the product login', () => {
    const app = assistantApp()
    const { result } = renderSession(app)

    expect(result.current.isAuthenticated).toBe(false)

    act(() => {
      result.current.signIn()
    })
    expect(beginDocsProductSignIn).toHaveBeenCalledTimes(1)

    act(() => {
      app.stores.auth.setState({ token: 'product-token' })
    })
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('refuses to answer outside the assistant session rather than inventing one', () => {
    // #472 must not be able to reach a conversation list that no session backs.
    expect(() => renderHook(() => useDocsAssistantSession())).toThrow(
      /outside the documentation assistant session/
    )
  })
})
