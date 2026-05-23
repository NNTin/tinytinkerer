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

import { canStartGitHubOAuth, completeGitHubOAuthCallback, startGitHubOAuth } from '../src/auth.js'
import { configureBrowserShell } from '../src/shell.js'

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
    configureBrowserShell({
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      githubClientId: 'github-client-id'
    })
  })

  it('does not write oauth state until oauth is explicitly started', () => {
    expect(canStartGitHubOAuth()).toBe(true)
    expect(sessionStorage.getItem('tinytinkerer-test:oauth_state')).toBeNull()
  })

  it('stores oauth state under the shell namespace when oauth starts', () => {
    const assignSpy = stubLocationAssign()

    startGitHubOAuth()

    expect(assignSpy).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('tinytinkerer-test:oauth_state')).toBeTruthy()
    expect(sessionStorage.getItem('oauth_state')).toBeNull()
  })

  it('completes the callback and persists the exchanged token', async () => {
    const assignSpy = stubLocationAssign()
    startGitHubOAuth()
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
    const assignSpy = stubLocationAssign()
    startGitHubOAuth()
    expect(assignSpy).toHaveBeenCalledTimes(1)

    await expect(
      completeGitHubOAuthCallback({ code: 'abc123', state: 'wrong-state' })
    ).rejects.toThrow('Authentication failed. Please try signing in again.')
  })

  it('surfaces exchange failures', async () => {
    const assignSpy = stubLocationAssign()
    startGitHubOAuth()
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
      completeGitHubOAuthCallback({ code: 'abc123', state })
    ).rejects.toThrow('OAuth is not configured')

    await expect(
      completeGitHubOAuthCallback({ code: 'abc123', state })
    ).rejects.toThrow('Authentication failed. Please try signing in again.')
    vi.unstubAllGlobals()
  })

  it('reports oauth as unavailable in host-token mode', () => {
    configureBrowserShell({
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      authMode: 'host-token'
    })

    expect(canStartGitHubOAuth()).toBe(false)
  })
})
