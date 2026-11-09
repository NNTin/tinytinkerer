// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

/**
 * A signed-out `ChatApp` in an app that requires sign-in (`authMode: 'oauth'`,
 * issue #510 T5) shows a sign-in call to action instead of the chat, and sends
 * nothing to the edge. A `'hybrid'` app (every tinytinkerer surface) keeps its
 * anonymous composer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/db', () => ({
  createBrowserPersistence: () => ({
    preferences: { get: () => Promise.resolve(undefined), set: () => Promise.resolve() },
    conversations: {},
    authTokens: {
      getStoredToken: () => Promise.resolve(null),
      setStoredToken: () => Promise.resolve(),
      clearStoredToken: () => Promise.resolve()
    }
  })
}))

// jsdom has no `Element.scrollTo`; see human-prompt-minimized-attention.test.tsx.
vi.mock('../src/use-stick-to-bottom.js', () => ({
  useStickToBottom: () => ({
    scrollRef: { current: null },
    isPinned: true,
    showJumpButton: false,
    scrollToBottom: () => undefined
  })
}))

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConversationSlice } from '@tinytinkerer/app-core'
import {
  AppBrowserProvider,
  createBrowserApp,
  type AppSignIn,
  type BrowserApp
} from '../src/app.js'
import type { BrowserAuthMode } from '../src/config.js'
import { ChatApp } from '../src/chat-shell/chat-app.js'
import { noPlugins } from './plugin-catalogue-fixture'

const fetchSpy = vi.fn<typeof fetch>(() => Promise.reject(new Error('no network in tests')))

beforeEach(() => {
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

const slice = (id: string): ConversationSlice => ({
  id,
  title: 'A conversation',
  events: [],
  isRunning: false,
  isRetryPending: false,
  eventsLoaded: true
})

let appCounter = 0
const makeApp = (authMode: BrowserAuthMode, signIn?: AppSignIn): BrowserApp => {
  appCounter += 1
  const app = createBrowserApp(
    {
      storageNamespace: `tinytinkerer-sign-in-${appCounter}`,
      edgeBaseUrl: 'https://edge.test',
      authMode,
      githubClientId: 'client-id',
      githubRedirectUri: 'https://canfactory.test/auth/github/callback'
    },
    { plugins: noPlugins, ...(signIn ? { signIn } : {}) }
  )
  app.stores.chat.setState({
    hydrated: true,
    conversationId: 'conv-a',
    conversations: { 'conv-a': slice('conv-a') },
    conversationOrder: ['conv-a']
  })
  return app
}

const Loading = () => <p>loading</p>

const renderChat = (app: BrowserApp, mode: 'floating' | 'sidebar') =>
  render(
    <AppBrowserProvider app={app}>
      <ChatApp
        mode={mode}
        storageKey={`tinytinkerer:sign-in-${appCounter}`}
        LoadingComponent={Loading}
      />
    </AppBrowserProvider>
  )

/** Let mount effects (status polling, model catalogue, MCP discovery) run. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))

describe.each(['floating', 'sidebar'] as const)('ChatApp (%s) in an oauth app', (mode) => {
  it('shows a sign-in call to action instead of the composer and sends nothing', async () => {
    renderChat(makeApp('oauth'), mode)
    await settle()

    expect(screen.getByRole('region', { name: 'Sign in required' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('starts the app’s sign-in from the call to action', () => {
    const signIn = vi.fn<AppSignIn>(() => true)
    renderChat(makeApp('oauth', signIn), mode)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))

    expect(signIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when sign-in cannot start', () => {
    renderChat(
      makeApp('oauth', () => false),
      mode
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sign-in is unavailable in this deployment.'
    )
  })

  it('shows the composer once signed in', async () => {
    const app = makeApp('oauth')
    renderChat(app, mode)

    act(() => app.stores.auth.setState({ token: 'gho_token' }))

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sign in required' })).not.toBeInTheDocument()
  })
})

describe('ChatApp in a hybrid app', () => {
  it('keeps the anonymous composer while signed out', async () => {
    renderChat(makeApp('hybrid'), 'floating')

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sign in required' })).not.toBeInTheDocument()
  })
})
