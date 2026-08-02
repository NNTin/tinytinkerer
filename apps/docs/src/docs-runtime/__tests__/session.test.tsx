/**
 * The supported session/conversation service #472 is intended to consume (issue
 * #479). It has no consumer yet: what these tests pin is that the contract
 * exists, is exported, and cannot be satisfied by the wrong app.
 *
 * Driven against a real `BrowserApp`, a real chat store, and an in-memory
 * conversation repository — not mocked actions (issue #479 review, finding 4).
 * A test that stubs `restartConversation` can only prove that a wrapper called
 * one function; what the acceptance criterion asks for is the resulting state:
 * a fresh conversation, the old one gone, other conversations and the lab and
 * product namespaces untouched.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AppBrowserProvider, createBrowserApp, type BrowserApp } from '@tinytinkerer/app-browser'
import { DocsAssistantSessionContext } from '../assistant-session-context'
import { useDocsAssistantSession } from '../session'

const beginDocsProductSignIn = vi.hoisted(() => vi.fn())
vi.mock('../product-sign-in', () => ({ beginDocsProductSignIn }))

// One in-memory database per storage namespace, so "the assistant reset did not
// touch the lab" is a real observation rather than an assumption.
const databases = new Map<string, Map<string, { id: string; title: string; updatedAt: string }>>()

const namespaceOf = (app: BrowserApp): string => app.shell.config.storageNamespace

const attachRepository = (app: BrowserApp): void => {
  const conversations = new Map<string, { id: string; title: string; updatedAt: string }>()
  const events = new Map<string, unknown[]>()
  databases.set(namespaceOf(app), conversations)
  let nextId = 0

  Object.assign(app.shell, {
    preferences: {
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve()
    },
    conversations: {
      createConversation: () => {
        nextId += 1
        const conversation = {
          id: `${namespaceOf(app)}-conv-${nextId}`,
          title: 'New chat',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        conversations.set(conversation.id, conversation)
        events.set(conversation.id, [])
        return Promise.resolve(conversation)
      },
      deleteConversation: (id: string) => {
        conversations.delete(id)
        events.delete(id)
        return Promise.resolve()
      },
      listConversations: () => Promise.resolve(Array.from(conversations.values())),
      loadConversationEvents: (id: string) => Promise.resolve(events.get(id) ?? []),
      appendEvent: () => Promise.resolve(),
      resetConversation: (id: string) => {
        events.set(id, [])
        return Promise.resolve([])
      },
      renameConversation: (id: string, title: string) => {
        const existing = conversations.get(id)
        if (existing) conversations.set(id, { ...existing, title })
        return Promise.resolve()
      }
    }
  })
}

const seed = (
  app: BrowserApp,
  slices: { id: string; title: string; isRunning?: boolean }[],
  activeId: string
): void => {
  const repository = databases.get(namespaceOf(app))!
  for (const { id, title } of slices) {
    repository.set(id, { id, title, updatedAt: new Date().toISOString() })
  }
  app.stores.chat.setState({
    hydrated: true,
    conversationId: activeId,
    conversations: Object.fromEntries(
      slices.map(({ id, title, isRunning }) => [
        id,
        {
          id,
          title,
          events: [],
          isRunning: isRunning ?? false,
          isRetryPending: false,
          eventsLoaded: true
        }
      ])
    ),
    conversationOrder: slices.map(({ id }) => id)
  })
}

const makeApp = (storageNamespace: string): BrowserApp => {
  const app = createBrowserApp({ storageNamespace })
  attachRepository(app)
  return app
}

let assistant: BrowserApp
let lab: BrowserApp

beforeEach(() => {
  vi.clearAllMocks()
  databases.clear()
  assistant = makeApp('tinytinkerer-docs-assistant')
  lab = makeApp('tinytinkerer-docs-lab')
  seed(
    assistant,
    [
      { id: 'assistant-active', title: 'Plugin tools', isRunning: true },
      { id: 'assistant-other', title: 'Hosting questions' }
    ],
    'assistant-active'
  )
  seed(lab, [{ id: 'lab-conv', title: 'Lab demo' }], 'lab-conv')
})

const renderSession = (app: BrowserApp = assistant) =>
  renderHook(() => useDocsAssistantSession(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppBrowserProvider app={app}>
        <DocsAssistantSessionContext.Provider value={app}>
          {children}
        </DocsAssistantSessionContext.Provider>
      </AppBrowserProvider>
    )
  })

describe('useDocsAssistantSession', () => {
  it('exposes the assistant conversations in the store’s own order', () => {
    const { result } = renderSession()

    expect(result.current.conversations).toEqual([
      { id: 'assistant-active', title: 'Plugin tools', isRunning: true },
      { id: 'assistant-other', title: 'Hosting questions', isRunning: false }
    ])
    expect(result.current.activeConversationId).toBe('assistant-active')
  })

  it('forwards selection, creation, and deletion to the one assistant store', async () => {
    const { result } = renderSession()

    await act(async () => {
      await result.current.selectConversation('assistant-other')
    })
    expect(assistant.stores.chat.getState().conversationId).toBe('assistant-other')

    await act(async () => {
      await result.current.startNewConversation()
    })
    const created = assistant.stores.chat.getState().conversationId!
    expect(created).toMatch(/^tinytinkerer-docs-assistant-conv-/)

    await act(async () => {
      await result.current.deleteConversation('assistant-other')
    })
    expect(assistant.stores.chat.getState().conversations['assistant-other']).toBeUndefined()
  })

  it('restarts the active conversation into a fresh one, keeping the others', async () => {
    const { result } = renderSession()

    await act(async () => {
      await result.current.resetActiveConversation()
    })

    const state = assistant.stores.chat.getState()
    // A FRESH conversation, not the same one emptied in place: decision 5's
    // locked semantics. The old id is gone from the store and the repository.
    expect(state.conversationId).not.toBe('assistant-active')
    expect(state.conversationId).toMatch(/^tinytinkerer-docs-assistant-conv-/)
    expect(state.conversations['assistant-active']).toBeUndefined()
    expect(databases.get('tinytinkerer-docs-assistant')!.has('assistant-active')).toBe(false)
    expect(state.conversations[state.conversationId!]?.title).toBe('New chat')
    expect(state.conversations[state.conversationId!]?.events).toEqual([])

    // Every other assistant conversation survives…
    expect(state.conversations['assistant-other']?.title).toBe('Hosting questions')
    // …and no other namespace was touched.
    expect(lab.stores.chat.getState().conversationId).toBe('lab-conv')
    expect(databases.get('tinytinkerer-docs-lab')!.has('lab-conv')).toBe(true)
  })

  it('cancels the restarted conversation’s in-flight work', async () => {
    // `assistant-active` is seeded as running. After the restart nothing is
    // running: the conversation that held the run no longer exists, and the
    // fresh one has never been sent a prompt. The store aborts before the rows
    // disappear (app-core's restartConversationAction), so the doomed run cannot
    // keep streaming into a conversation that is gone.
    const { result } = renderSession()
    expect(result.current.conversations.some((entry) => entry.isRunning)).toBe(true)

    await act(async () => {
      await result.current.resetActiveConversation()
    })

    expect(result.current.conversations.some((entry) => entry.isRunning)).toBe(false)
    expect(assistant.stores.chat.getState().isRunning).toBe(false)
  })

  it('never reloads the page or deletes a database', async () => {
    const reload = vi.fn()
    const deleteDatabase = vi.fn()
    vi.stubGlobal('indexedDB', { deleteDatabase })
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload }
    })

    const { result } = renderSession()
    await act(async () => {
      await result.current.resetActiveConversation()
    })

    // The live labs delete their database and reload; a site-wide assistant must
    // do neither — that would reload the documentation out from under the reader
    // and take consent, authentication input and settings with it.
    expect(reload).not.toHaveBeenCalled()
    expect(deleteDatabase).not.toHaveBeenCalled()

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    vi.unstubAllGlobals()
  })

  it('reports anonymous use as a normal state and offers the product login', async () => {
    const { result } = renderSession()

    expect(result.current.isAuthenticated).toBe(false)

    act(() => {
      result.current.signIn()
    })
    expect(beginDocsProductSignIn).toHaveBeenCalledTimes(1)

    act(() => {
      assistant.stores.auth.setState({ token: 'product-token' })
    })
    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true)
    })
  })

  it('refuses to answer outside the assistant session rather than inventing one', () => {
    expect(() => renderHook(() => useDocsAssistantSession())).toThrow(
      /outside the documentation assistant session/
    )
  })

  it('refuses a live-lab session, which is a different app with different conversations', () => {
    // The isolation this API exists to enforce: under a lab provider, a guard
    // that only asked "is SOME BrowserApp mounted?" would have silently read and
    // mutated LAB conversations while calling itself the assistant session.
    expect(() =>
      renderHook(() => useDocsAssistantSession(), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <AppBrowserProvider app={lab}>{children}</AppBrowserProvider>
        )
      })
    ).toThrow(/documentation assistant/)

    expect(lab.stores.chat.getState().conversations['lab-conv']?.title).toBe('Lab demo')
  })
})
