// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserApp, BrowserShell, BrowserShellConfig } from '../src/index.js'
import {
  canStartGitHubOAuth,
  completeGitHubOAuth,
  completeGitHubOAuthCallback,
  consumeGitHubOAuthReturnUrl,
  GITHUB_OAUTH_CALLBACK_PATH,
  isSignInRequired,
  startGitHubOAuth
} from '../src/index.js'
import { wasOAuthCallbackHandled } from '../src/telemetry/oauth-callback-handled.js'

const mockAuthStore = vi.hoisted(() => ({
  setToken: vi.fn().mockResolvedValue(undefined)
}))

// Explicit `undefined` lets a test drop a default (e.g. `githubRedirectUri`).
const createAuthApp = (
  config: { [K in keyof BrowserShellConfig]?: BrowserShellConfig[K] | undefined } = {}
): BrowserApp =>
  ({
    shell: {
      config: {
        edgeBaseUrl: 'http://edge.local',
        storageNamespace: 'tinytinkerer-test',
        authMode: 'hybrid',
        hostToken: null,
        githubClientId: 'github-client-id',
        githubRedirectUri: 'http://localhost:3111/#/auth/callback',
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

const resetWindowEmbedding = () => {
  Object.defineProperty(window, 'parent', {
    value: window,
    configurable: true
  })
  Object.defineProperty(window, 'top', {
    value: window,
    configurable: true
  })
}

const stubEmbeddedContext = (topHref = 'http://localhost:3111/') => {
  const topAssignSpy = vi.fn<(url: string) => void>()

  Object.defineProperty(window, 'parent', {
    value: { location: { href: topHref } },
    configurable: true
  })
  Object.defineProperty(window, 'top', {
    value: {
      location: {
        href: topHref,
        assign: topAssignSpy
      }
    },
    configurable: true
  })

  return topAssignSpy
}

describe('auth helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetWindowEmbedding()
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

  it('remembers the current top-level document as the return url when not embedded', () => {
    // Non-embedded surfaces (/, /web, /widget, /mobile opened directly) must
    // return to the exact page the user started on after the callback completes
    // at the origin root — otherwise login strands them on `/`.
    const app = createAuthApp()
    const href = 'http://localhost:3111/web/'
    vi.stubGlobal('location', { ...window.location, href, assign: vi.fn() })

    startGitHubOAuth(app.shell)

    expect(sessionStorage.getItem('tinytinkerer-test:oauth_return_url')).toBe(href)
  })

  it('escapes iframe oauth to the top-level tab and remembers the host return url', () => {
    const app = createAuthApp()
    const topAssignSpy = stubEmbeddedContext()

    startGitHubOAuth(app.shell)

    expect(topAssignSpy).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('tinytinkerer-test:oauth_state')).toBeTruthy()
    expect(sessionStorage.getItem('tinytinkerer-test:oauth_return_url')).toBe(
      'http://localhost:3111/'
    )
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
    await expect(completeGitHubOAuthCallback(app, { code: null, state: 'state' })).rejects.toThrow(
      'No authorization code received from GitHub.'
    )
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

    await expect(completeGitHubOAuthCallback(app, { code: 'abc123', state })).rejects.toThrow(
      'OAuth is not configured'
    )
    vi.unstubAllGlobals()
  })

  it('reports oauth as unavailable in host-token mode', () => {
    const app = createAuthApp({ authMode: 'host-token' })
    expect(canStartGitHubOAuth(app.shell)).toBe(false)
  })

  it('consumes the stored oauth return url once', () => {
    const app = createAuthApp()
    sessionStorage.setItem('tinytinkerer-test:oauth_return_url', 'http://localhost:3111/')

    expect(consumeGitHubOAuthReturnUrl(app.shell)).toBe('http://localhost:3111/')
    expect(consumeGitHubOAuthReturnUrl(app.shell)).toBeNull()
  })

  it('reports oauth as unavailable without a redirect uri the edge could accept', () => {
    const app = createAuthApp({ githubRedirectUri: undefined })
    expect(canStartGitHubOAuth(app.shell)).toBe(false)
  })

  it('requires sign-in only in oauth mode', () => {
    expect(isSignInRequired(createAuthApp({ authMode: 'oauth' }).shell)).toBe(true)
    expect(isSignInRequired(createAuthApp({ authMode: 'hybrid' }).shell)).toBe(false)
    expect(isSignInRequired(createAuthApp({ authMode: 'host-token' }).shell)).toBe(false)
  })
})

describe('completeGitHubOAuth (embedding host callback, issue #510)', () => {
  const origin = window.location.origin
  const redirectUri = `${origin}${GITHUB_OAUTH_CALLBACK_PATH}`
  const hostApp = () =>
    createAuthApp({
      storageNamespace: 'canfactory',
      authMode: 'oauth',
      githubRedirectUri: redirectUri
    })
  const callbackUrl = (query: string) => `${redirectUri}?${query}`

  const stubExchange = (body: unknown = { accessToken: 'ghu_host_token' }, status = 200) => {
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

  beforeEach(() => {
    sessionStorage.clear()
    vi.unstubAllGlobals()
    mockAuthStore.setToken.mockClear()
  })

  it('verifies state, exchanges the code, signs in, and returns the saved return url', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-1')
    sessionStorage.setItem('canfactory:oauth_return_url', `${origin}/boards/42?tab=guide`)
    const fetchSpy = stubExchange()

    const returnUrl = await completeGitHubOAuth(hostApp(), callbackUrl('code=abc123&state=state-1'))

    expect(returnUrl).toBe(`${origin}/boards/42?tab=guide`)
    expect(mockAuthStore.setToken).toHaveBeenCalledWith('ghu_host_token')
    const [input, init] = fetchSpy.mock.calls[0]!
    expect(input).toBe('http://edge.local/auth/github/exchange')
    expect(JSON.parse(init?.body as string)).toEqual({ code: 'abc123', redirectUri })
    // Both one-shot values are consumed.
    expect(sessionStorage.getItem('canfactory:oauth_state')).toBeNull()
    expect(sessionStorage.getItem('canfactory:oauth_return_url')).toBeNull()
    expect(wasOAuthCallbackHandled()).toBe(true)
  })

  it('reads the current location by default', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-2')
    stubExchange()
    window.history.replaceState(null, '', `${GITHUB_OAUTH_CALLBACK_PATH}?code=abc123&state=state-2`)

    try {
      await expect(completeGitHubOAuth(hostApp())).resolves.toBeNull()
      expect(mockAuthStore.setToken).toHaveBeenCalledWith('ghu_host_token')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('also understands a hash-routed callback url', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-3')
    stubExchange()

    await completeGitHubOAuth(hostApp(), `${origin}/#/auth/callback?code=abc123&state=state-3`)

    expect(mockAuthStore.setToken).toHaveBeenCalledWith('ghu_host_token')
  })

  it('checks state in the app’s own storage namespace', async () => {
    // Started by a different app on the page (the default namespace).
    sessionStorage.setItem('tinytinkerer:oauth_state', 'state-4')
    const fetchSpy = stubExchange()

    await expect(
      completeGitHubOAuth(hostApp(), callbackUrl('code=abc123&state=state-4'))
    ).rejects.toThrow('Authentication failed. Please try signing in again.')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mockAuthStore.setToken).not.toHaveBeenCalled()
  })

  it('rejects a missing code without calling the edge', async () => {
    const fetchSpy = stubExchange()

    await expect(
      completeGitHubOAuth(hostApp(), callbackUrl('error=access_denied'))
    ).rejects.toThrow('No authorization code received from GitHub.')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces the edge’s rejection of the redirect uri', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-5')
    sessionStorage.setItem('canfactory:oauth_return_url', `${origin}/boards/42`)
    stubExchange({ error: 'Invalid OAuth redirect URI' }, 400)

    await expect(
      completeGitHubOAuth(hostApp(), callbackUrl('code=abc123&state=state-5'))
    ).rejects.toThrow('Invalid OAuth redirect URI')
    expect(mockAuthStore.setToken).not.toHaveBeenCalled()
  })

  it('drops a cross-origin return url instead of handing it to replaceState', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-6')
    sessionStorage.setItem('canfactory:oauth_return_url', 'https://elsewhere.example/boards')
    stubExchange()

    await expect(
      completeGitHubOAuth(hostApp(), callbackUrl('code=abc123&state=state-6'))
    ).resolves.toBeNull()
  })

  it('refuses to exchange without a configured redirect uri', async () => {
    sessionStorage.setItem('canfactory:oauth_state', 'state-7')
    const fetchSpy = stubExchange()

    await expect(
      completeGitHubOAuth(
        createAuthApp({ storageNamespace: 'canfactory', githubRedirectUri: undefined }),
        callbackUrl('code=abc123&state=state-7')
      )
    ).rejects.toThrow('GitHub sign-in is not configured for this page.')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
