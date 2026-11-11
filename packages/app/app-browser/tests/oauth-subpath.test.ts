// @vitest-environment jsdom
import { EDGE_ROUTE_PATHS } from '@tinytinkerer/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserShell, BrowserShellConfig } from '../src/index.js'
import {
  type GitHubOAuthCallbackConfig,
  completeGitHubOAuth,
  GITHUB_OAUTH_CALLBACK_PATH,
  GITHUB_OAUTH_EXCHANGE_PATH,
  isGitHubOAuthCallback,
  oauthPendingTokenStorageKey
} from '../src/oauth.js'
import { GITHUB_OAUTH_CALLBACK_PATH as ROOT_CALLBACK_PATH } from '../src/index.js'
import { createAuthStore } from '../src/stores/auth-store.js'
import { wasOAuthCallbackHandled } from '../src/telemetry/oauth-callback-handled.js'

// The light, app-free completion behind `@nntin/tinytinkerer-embed/oauth`
// (issue #518, F3), and the hand-off to the next app boot.

const origin = window.location.origin
const redirectUri = `${origin}${GITHUB_OAUTH_CALLBACK_PATH}`
const config = {
  edgeBaseUrl: 'http://edge.local',
  storageNamespace: 'canfactory',
  githubRedirectUri: redirectUri
}
const callbackUrl = (query: string) => `${redirectUri}?${query}`

const stubExchange = (body: unknown = { accessToken: 'ghu_light_token' }, status = 200) => {
  const spy = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    )
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

const memoryShell = (storageNamespace: string) => {
  let stored: string | null = null
  const shell = {
    config: { storageNamespace },
    authTokens: {
      getStoredToken: () => Promise.resolve(stored),
      setStoredToken: (token: string) => {
        stored = token
        return Promise.resolve()
      },
      clearStoredToken: () => {
        stored = null
        return Promise.resolve()
      },
      getHostToken: () => null
    }
  } as unknown as BrowserShell
  return { shell, stored: () => stored }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  vi.unstubAllGlobals()
})

// The light completion's config is exactly the slice of BrowserShellConfig it
// reads, both ways round, so a host can pass either object to it.
type PickedConfig = Pick<
  BrowserShellConfig,
  'edgeBaseUrl' | 'storageNamespace' | 'githubRedirectUri'
>
const configTypesMatch: [PickedConfig, GitHubOAuthCallbackConfig] extends [
  GitHubOAuthCallbackConfig,
  PickedConfig
]
  ? true
  : false = true

describe('the /oauth constants', () => {
  it('takes the BrowserShellConfig slice it reads', () => {
    expect(configTypesMatch).toBe(true)
  })

  it('names the edge exchange route the contracts define', () => {
    expect(GITHUB_OAUTH_EXCHANGE_PATH).toBe(EDGE_ROUTE_PATHS.authGithubExchange)
  })

  it('is the root export’s callback path', () => {
    expect(GITHUB_OAUTH_CALLBACK_PATH).toBe(ROOT_CALLBACK_PATH)
  })
})

describe('isGitHubOAuthCallback', () => {
  it('matches the callback path, with or without a query', () => {
    expect(isGitHubOAuthCallback(callbackUrl('code=a&state=b'))).toBe(true)
    expect(isGitHubOAuthCallback(new URL(redirectUri))).toBe(true)
    expect(isGitHubOAuthCallback(`${origin}/boards/42`)).toBe(false)
    expect(isGitHubOAuthCallback(`${origin}/auth/github/callback/extra`)).toBe(false)
  })

  it('reads the current location by default', () => {
    window.history.replaceState(null, '', `${GITHUB_OAUTH_CALLBACK_PATH}?code=a`)
    try {
      expect(isGitHubOAuthCallback()).toBe(true)
    } finally {
      window.history.replaceState(null, '', '/')
    }
    expect(isGitHubOAuthCallback()).toBe(false)
  })
})

describe('completeGitHubOAuth (light, no BrowserApp)', () => {
  it('verifies state, exchanges the code, saves the token and returns the return url', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-1')
    sessionStorage.setItem('canfactory:oauth_return_url', `${origin}/#/models/fly-trap`)
    const fetchSpy = stubExchange()

    const returnUrl = await completeGitHubOAuth(config, callbackUrl('code=abc&state=state-1'))

    expect(returnUrl).toBe(`${origin}/#/models/fly-trap`)
    const [input, init] = fetchSpy.mock.calls[0]!
    expect(input).toBe(`http://edge.local${EDGE_ROUTE_PATHS.authGithubExchange}`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ code: 'abc', redirectUri })
    expect(localStorage.getItem('canfactory:oauth_pending_token')).toBe('ghu_light_token')
    expect(sessionStorage.getItem('canfactory:oauth_state')).toBeNull()
    expect(sessionStorage.getItem('canfactory:oauth_return_url')).toBeNull()
    expect(wasOAuthCallbackHandled()).toBe(true)
  })

  it('defaults the namespace exactly as the app does', async () => {
    sessionStorage.setItem('tinytinkerer:oauth_state', 'state-d')
    stubExchange()

    await completeGitHubOAuth(
      { edgeBaseUrl: 'http://edge.local', githubRedirectUri: redirectUri },
      callbackUrl('code=abc&state=state-d')
    )

    expect(localStorage.getItem(oauthPendingTokenStorageKey(undefined))).toBe('ghu_light_token')
    expect(oauthPendingTokenStorageKey(undefined)).toBe('tinytinkerer:oauth_pending_token')
  })

  it('rejects a mismatched state without calling the edge', async () => {
    sessionStorage.setItem('tinytinkerer:oauth_state', 'state-2')
    const fetchSpy = stubExchange()

    await expect(
      completeGitHubOAuth(config, callbackUrl('code=abc&state=state-2'))
    ).rejects.toThrow('Authentication failed. Please try signing in again.')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('rejects a missing code without calling the edge', async () => {
    const fetchSpy = stubExchange()

    await expect(completeGitHubOAuth(config, callbackUrl('error=access_denied'))).rejects.toThrow(
      'No authorization code received from GitHub.'
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces the edge’s error and saves nothing', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-3')
    sessionStorage.setItem('canfactory:oauth_return_url', `${origin}/`)
    stubExchange({ error: 'Invalid OAuth redirect URI' }, 400)

    await expect(
      completeGitHubOAuth(config, callbackUrl('code=abc&state=state-3'))
    ).rejects.toThrow('Invalid OAuth redirect URI')
    expect(localStorage.length).toBe(0)
    // Kept for a retry, exactly like the app-bound completion.
    expect(sessionStorage.getItem('canfactory:oauth_return_url')).toBe(`${origin}/`)
  })

  it('rejects a 200 without a token', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-4')
    stubExchange({})

    await expect(
      completeGitHubOAuth(config, callbackUrl('code=abc&state=state-4'))
    ).rejects.toThrow('Authentication failed')
    expect(localStorage.length).toBe(0)
  })

  it('refuses to exchange without a redirect uri', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-5')
    const fetchSpy = stubExchange()

    await expect(
      completeGitHubOAuth({ storageNamespace: 'canfactory' }, callbackUrl('code=abc&state=state-5'))
    ).rejects.toThrow('GitHub sign-in is not configured for this page.')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('drops a cross-origin return url', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-6')
    sessionStorage.setItem('canfactory:oauth_return_url', 'https://evil.example/')
    stubExchange()

    await expect(
      completeGitHubOAuth(config, callbackUrl('code=abc&state=state-6'))
    ).resolves.toBeNull()
  })
})

describe('the next app boot', () => {
  it('moves the pending token into the app’s own token storage', async () => {
    localStorage.setItem('canfactory:oauth_pending_token', 'ghu_light_token')
    const { shell, stored } = memoryShell('canfactory')
    const store = createAuthStore(shell)

    await store.getState().initialize()

    expect(store.getState().token).toBe('ghu_light_token')
    expect(stored()).toBe('ghu_light_token')
    expect(localStorage.getItem('canfactory:oauth_pending_token')).toBeNull()
  })

  it('still boots, signed out, when the handoff write fails, and keeps the key for a retry', async () => {
    localStorage.setItem('canfactory:oauth_pending_token', 'ghu_light_token')
    const { shell } = memoryShell('canfactory')
    shell.authTokens.setStoredToken = () => Promise.reject(new Error('QuotaExceededError'))
    const store = createAuthStore(shell)

    await expect(store.getState().initialize()).resolves.toBeUndefined()

    expect(store.getState().token).toBeNull()
    expect(localStorage.getItem('canfactory:oauth_pending_token')).toBe('ghu_light_token')
  })

  it('ignores another namespace’s pending token', async () => {
    localStorage.setItem('other:oauth_pending_token', 'ghu_other')
    const { shell } = memoryShell('canfactory')
    const store = createAuthStore(shell)

    await store.getState().initialize()

    expect(store.getState().token).toBeNull()
    expect(localStorage.getItem('other:oauth_pending_token')).toBe('ghu_other')
  })

  it('signing out discards a pending token', async () => {
    const { shell } = memoryShell('canfactory')
    const store = createAuthStore(shell)
    await store.getState().initialize()
    localStorage.setItem('canfactory:oauth_pending_token', 'ghu_late')

    await store.getState().clearToken()

    expect(localStorage.getItem('canfactory:oauth_pending_token')).toBeNull()
  })

  it('completes end to end: light callback, then boot', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-e2e')
    stubExchange()
    await completeGitHubOAuth(config, callbackUrl('code=abc&state=state-e2e'))

    const { shell } = memoryShell('canfactory')
    const store = createAuthStore(shell)
    await store.getState().initialize()

    expect(store.getState().token).toBe('ghu_light_token')
  })
})
