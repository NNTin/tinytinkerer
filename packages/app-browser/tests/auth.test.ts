// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserApp, BrowserShell, BrowserShellConfig } from '../src/index.js'
import {
  canStartGitHubOAuth,
  completeGitHubOAuthCallback,
  startGitHubOAuth
} from '../src/index.js'

const mockAuthStore = vi.hoisted(() => ({
  setToken: vi.fn().mockResolvedValue(undefined)
}))

const createAuthApp = (config: BrowserShellConfig = {}): BrowserApp =>
  ({
    shell: {
      config: {
        edgeBaseUrl: 'http://edge.local',
        storageNamespace: 'tinytinkerer-test',
        authMode: 'hybrid',
        hostToken: null,
        githubClientId: 'github-client-id',
        ...config
      }
    } as BrowserShell,
    stores: {
      auth: {
        getState: () => mockAuthStore
      }
    }
  }) as unknown as BrowserApp

const stubLocationAssign = () => {
  const assignSpy = vi.fn<(url: string) => void>()
  vi.stubGlobal('location', {
    ...window.location,
    assign: assignSpy
  })

  return assignSpy
}

describe('auth helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mockAuthStore.setToken.mockClear()
  })

  it('does not write oauth state until oauth is explicitly started', () => {
    const app = createAuthApp()
    expect(canStartGitHubOAuth(app.shell)).toBe(true)
    expect(sessionStorage.getItem('tinytinkerer-test:oauth_state')).toBeNull()
  })

  it('stores oauth state under the shell namespace when oauth starts', () => {
    const app = createAuthApp()
    const assignSpy = stubLocationAssign()

    startGitHubOAuth(app.shell)

    expect(assignSpy).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('tinytinkerer-test:oauth_state')).toBeTruthy()
    expect(sessionStorage.getItem('oauth_state')).toBeNull()
  })

  it('completes the callback and persists the exchanged token', async () => {
    const app = createAuthApp()
    const assignSpy = stubLocationAssign()
    startGitHubOAuth(app.shell)
    const redirectUrl = assignSpy.mock.calls[0]?.[0]
    const state = redirectUrl ? new URL(String(redirectUrl)).searchParams.get('state') : null

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'ghu_test_token' }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )

    await completeGitHubOAuthCallback(app, { code: 'abc123', state })

    expect(mockAuthStore.setToken).toHaveBeenCalledWith('ghu_test_token')
    vi.unstubAllGlobals()
  })

  it('rejects missing authorization codes', async () => {
    const app = createAuthApp()
    await expect(
      completeGitHubOAuthCallback(app, { code: null, state: 'state' })
    ).rejects.toThrow('No authorization code received from GitHub.')
  })

  it('rejects invalid oauth state', async () => {
    const app = createAuthApp()
    const assignSpy = stubLocationAssign()
    startGitHubOAuth(app.shell)
    expect(assignSpy).toHaveBeenCalledTimes(1)

    await expect(
      completeGitHubOAuthCallback(app, { code: 'abc123', state: 'wrong-state' })
    ).rejects.toThrow('Authentication failed. Please try signing in again.')
  })

  it('surfaces exchange failures', async () => {
    const app = createAuthApp()
    const assignSpy = stubLocationAssign()
    startGitHubOAuth(app.shell)
    const redirectUrl = assignSpy.mock.calls[0]?.[0]
    const state = redirectUrl ? new URL(String(redirectUrl)).searchParams.get('state') : null

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'OAuth is not configured' }), {
            status: 501,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )

    await expect(
      completeGitHubOAuthCallback(app, { code: 'abc123', state })
    ).rejects.toThrow('OAuth is not configured')
    vi.unstubAllGlobals()
  })

  it('reports oauth as unavailable in host-token mode', () => {
    const app = createAuthApp({ authMode: 'host-token' })
    expect(canStartGitHubOAuth(app.shell)).toBe(false)
  })
})
