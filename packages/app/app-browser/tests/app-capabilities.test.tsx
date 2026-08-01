// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

/**
 * The host-provided capabilities an embedder can attach to a `BrowserApp`
 * (issue #480): sign-in, and which reset its surfaces perform.
 *
 * Both exist because the documentation assistant cannot use the defaults — it
 * runs `authMode: 'host-token'`, so it can never start OAuth itself, and #479
 * locked a reset that discards the conversation rather than emptying it in place.
 * Both default to today's behaviour for every existing surface, which is the
 * property most worth pinning here.
 *
 * Driven through the real `createBrowserApp` and the real surface controllers,
 * because the wiring between them is the thing under test.
 */
import { AppBrowserProvider, createBrowserApp, type BrowserApp } from '../src/index.js'
import { useChatSurfaceController, useSettingsSurfaceController } from '../src/surfaces.js'

vi.mock('../src/plugins/registry.js', () => ({ loadPluginModules: () => Promise.resolve([]) }))

const wrapper =
  (app: BrowserApp) =>
  ({ children }: { children: ReactNode }) => (
    <AppBrowserProvider app={app}>{children}</AppBrowserProvider>
  )

const buildApp = (options: Parameters<typeof createBrowserApp>[1] = {}): BrowserApp =>
  createBrowserApp({ storageNamespace: 'tinytinkerer-capabilities-test' }, options)

describe('sign-in capability', () => {
  it('defaults to the shell"s own OAuth, routed through Settings', () => {
    // No client id in this config, so the shell cannot start OAuth — which is
    // exactly the state that used to render "Sign in with GitHub to enable AI
    // responses" above no button at all.
    const { result } = renderHook(() => useSettingsSurfaceController(), {
      wrapper: wrapper(buildApp())
    })

    expect(result.current.canSignIn).toBe(false)
    expect(result.current.signIn()).toBe(false)
    expect(result.current.signInOpensSettings).toBe(true)
  })

  it('uses a host-provided sign-in, and starts it from the affordance itself', () => {
    const signIn = vi.fn(() => true)
    const { result } = renderHook(() => useSettingsSurfaceController(), {
      wrapper: wrapper(buildApp({ signIn }))
    })

    expect(result.current.canSignIn).toBe(true)
    expect(result.current.signInOpensSettings).toBe(false)
    expect(result.current.signIn()).toBe(true)
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('reports a host sign-in that could not start', () => {
    // `beginDocsProductSignIn` returns false when the deployment has no GitHub
    // client id. A surface must be able to say so rather than look broken.
    const { result } = renderHook(() => useSettingsSurfaceController(), {
      wrapper: wrapper(buildApp({ signIn: () => false }))
    })

    expect(result.current.canSignIn).toBe(true)
    expect(result.current.signIn()).toBe(false)
  })
})

describe('conversation reset behaviour', () => {
  it('clears in place by default', () => {
    const app = buildApp()
    expect(app.conversationReset).toBe('clear-in-place')

    const clear = vi.fn(() => Promise.resolve())
    const restart = vi.fn(() => Promise.resolve())
    app.stores.chat.setState({ resetConversation: clear, restartConversation: restart })

    const { result } = renderHook(() => useChatSurfaceController(), { wrapper: wrapper(app) })
    void result.current.resetConversation()

    expect(clear).toHaveBeenCalledTimes(1)
    expect(restart).not.toHaveBeenCalled()
  })

  it('restarts when the app asks for it, so the widget"s button matches #479', () => {
    const app = buildApp({ conversationReset: 'restart' })
    expect(app.conversationReset).toBe('restart')

    const clear = vi.fn(() => Promise.resolve())
    const restart = vi.fn(() => Promise.resolve())
    app.stores.chat.setState({ resetConversation: clear, restartConversation: restart })

    const { result } = renderHook(() => useChatSurfaceController(), { wrapper: wrapper(app) })
    void result.current.resetConversation()

    expect(restart).toHaveBeenCalledTimes(1)
    expect(clear).not.toHaveBeenCalled()
  })
})
