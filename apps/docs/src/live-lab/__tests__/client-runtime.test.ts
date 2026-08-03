import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DOCS_LAB_STORAGE_NAMESPACE } from '../constants'

vi.mock('@tinytinkerer/app-browser/styles.css', () => ({}))

const createBrowserShell = vi.fn((config: Record<string, unknown>) => ({
  config,
  authTokens: { getStoredToken: vi.fn().mockResolvedValue(null) }
}))
const createBrowserApp = vi.fn((config: Record<string, unknown>) => ({
  shell: { config },
  stores: {}
}))
const resolveBrowserShellBootstrapConfig = vi.fn((options: Record<string, unknown>) => ({
  ...options
}))
const canStartGitHubOAuth = vi.fn(() => true)
const startGitHubOAuth = vi.fn()

const genericToolTreeSummarizer = vi.fn()

vi.mock('@tinytinkerer/app-browser', () => ({
  createBrowserShell,
  createBrowserApp,
  genericToolTreeSummarizer,
  resolveBrowserShellBootstrapConfig,
  canStartGitHubOAuth,
  startGitHubOAuth,
  useAuthStore: vi.fn(),
  useChatStore: vi.fn(),
  useChatCooldown: vi.fn(),
  BrowserAppShell: () => null,
  NO_GLOBAL_HOST_CAPABILITIES: {
    telemetryConsent: false,
    privacyUpdate: false,
    konami: false
  }
}))

vi.mock('@docusaurus/useDocusaurusContext', () => ({
  default: () => ({ siteConfig: { customFields: {} } })
}))

const runtimeConfig = {
  edgeBaseUrl: 'https://edge.example',
  githubClientId: 'client-123',
  sentryDsn: undefined,
  sentryEnvironment: undefined,
  productBaseUrl: '/'
}

describe('client-runtime module singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    createBrowserShell.mockImplementation((config: Record<string, unknown>) => ({
      config,
      authTokens: { getStoredToken: vi.fn().mockResolvedValue(null) }
    }))
    createBrowserApp.mockImplementation((config: Record<string, unknown>) => ({
      shell: { config },
      stores: {}
    }))
    resolveBrowserShellBootstrapConfig.mockImplementation((options: Record<string, unknown>) => ({
      ...options
    }))
    canStartGitHubOAuth.mockReturnValue(true)
  })

  it('ensureDocsLabApp creates the BrowserApp at most once for many labs on one page', async () => {
    const { ensureDocsLabApp } = await import('../client-runtime')
    const [first, second, third] = await Promise.all([
      ensureDocsLabApp(runtimeConfig),
      ensureDocsLabApp(runtimeConfig),
      ensureDocsLabApp(runtimeConfig)
    ])
    expect(createBrowserApp).toHaveBeenCalledTimes(1)
    expect(first.app).toBe(second.app)
    expect(second.app).toBe(third.app)
  })

  it('builds the docs session with an isolated storage namespace and a borrowed hostToken, never writing the token back', async () => {
    const getStoredToken = vi.fn().mockResolvedValue('the-shared-token')
    createBrowserShell.mockImplementationOnce(() => ({
      config: {},
      authTokens: { getStoredToken, setStoredToken: vi.fn(), clearStoredToken: vi.fn() }
    }))

    const { ensureDocsLabApp } = await import('../client-runtime')
    await ensureDocsLabApp(runtimeConfig)

    // The FIRST createBrowserShell call is the read-only peek at the product's
    // own (default-namespace) token store — it must ask for no storage namespace
    // override, i.e. it reads whatever the main app itself uses.
    expect(createBrowserShell).toHaveBeenNthCalledWith(1, {})
    expect(getStoredToken).toHaveBeenCalledTimes(1)

    const [resolvedConfig] = resolveBrowserShellBootstrapConfig.mock.calls[0]
    expect(resolvedConfig.storageNamespace).toBe(DOCS_LAB_STORAGE_NAMESPACE)
    expect(resolvedConfig.authMode).toBe('host-token')
    expect(resolvedConfig.hostToken).toBe('the-shared-token')
  })

  // Issue #479: the assistant runtime host at @theme/Root owns every
  // document-global effect for the documentation site, so a lab must claim none
  // of them — otherwise a lab booting first would configure telemetry under its
  // own namespace and could restore its own stale consent over the assistant's.
  it('claims no document-global effect', async () => {
    const { ensureDocsLabApp } = await import('../client-runtime')
    await ensureDocsLabApp(runtimeConfig)

    const [, options] = createBrowserApp.mock.calls[0] as unknown as [
      unknown,
      { documentGlobals: Record<string, boolean> }
    ]
    expect(options.documentGlobals).toEqual({
      brandMetadata: false,
      telemetry: false,
      contentRenderReporter: false,
      oauthCallbackWatchdog: false
    })
  })

  it('resetDocsLabSession deletes only the docs-lab database and reloads, then forces a fresh session next time', async () => {
    const deleteDatabase = vi.fn(() => {
      const request: {
        onsuccess?: () => void
        onerror?: () => void
        onblocked?: () => void
        error?: Error
      } = {}
      queueMicrotask(() => request.onsuccess?.())
      return request
    })
    vi.stubGlobal('indexedDB', { deleteDatabase })
    const reload = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload }
    })

    const { ensureDocsLabApp, resetDocsLabSession } = await import('../client-runtime')
    await ensureDocsLabApp(runtimeConfig)
    expect(createBrowserApp).toHaveBeenCalledTimes(1)

    await resetDocsLabSession()

    expect(deleteDatabase).toHaveBeenCalledTimes(1)
    expect(deleteDatabase).toHaveBeenCalledWith(DOCS_LAB_STORAGE_NAMESPACE)
    expect(deleteDatabase).not.toHaveBeenCalledWith('tinytinkerer')
    expect(reload).toHaveBeenCalledTimes(1)

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })

    // The shared singleton must be invalidated by a reset, not reused stale.
    await ensureDocsLabApp(runtimeConfig)
    expect(createBrowserApp).toHaveBeenCalledTimes(2)

    vi.unstubAllGlobals()
  })
})
