// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthStore = vi.hoisted(() => ({
  setToken: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../src/stores/auth-store.js', () => ({
  useAuthStore: {
    getState: () => mockAuthStore
  }
}))

import {
  buildGitHubLoginUrl,
  completeGitHubOAuthCallback,
  validateOAuthState
} from '../src/auth.js'
import { initializeBrowserShell } from '../src/shell.js'

describe('auth helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
    mockAuthStore.setToken.mockClear()
    initializeBrowserShell({
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      githubClientId: 'github-client-id'
    })
  })

  it('stores oauth state under the shell namespace', () => {
    buildGitHubLoginUrl()
    expect(sessionStorage.getItem('tinytinkerer-test:oauth_state')).toBeTruthy()
    expect(sessionStorage.getItem('oauth_state')).toBeNull()
  })

  it('completes the callback and persists the exchanged token', async () => {
    const loginUrl = buildGitHubLoginUrl()
    const state = loginUrl ? new URL(loginUrl).searchParams.get('state') : null

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

    await completeGitHubOAuthCallback({ code: 'abc123', state })

    expect(mockAuthStore.setToken).toHaveBeenCalledWith('ghu_test_token')
    vi.unstubAllGlobals()
  })

  it('rejects missing authorization codes', async () => {
    await expect(
      completeGitHubOAuthCallback({ code: null, state: 'state' })
    ).rejects.toThrow('No authorization code received from GitHub.')
  })

  it('rejects invalid oauth state', async () => {
    buildGitHubLoginUrl()

    await expect(
      completeGitHubOAuthCallback({ code: 'abc123', state: 'wrong-state' })
    ).rejects.toThrow('Authentication failed. Please try signing in again.')
  })

  it('surfaces exchange failures', async () => {
    const loginUrl = buildGitHubLoginUrl()
    const state = loginUrl ? new URL(loginUrl).searchParams.get('state') : null

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
      completeGitHubOAuthCallback({ code: 'abc123', state })
    ).rejects.toThrow('OAuth is not configured')

    expect(validateOAuthState(state)).toBe(false)
    vi.unstubAllGlobals()
  })
})
