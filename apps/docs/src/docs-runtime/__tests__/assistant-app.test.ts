/**
 * The global assistant singleton (issue #479): one session for the whole
 * documentation SPA, isolated from every live lab and from the product.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DOCS_ASSISTANT_STORAGE_NAMESPACE } from '../assistant-constants'
import { DOCS_LAB_STORAGE_NAMESPACE } from '../../live-lab/constants'

vi.mock('@tinytinkerer/app-browser/styles.css', () => ({}))

const createBrowserShell = vi.fn(() => ({
  config: {},
  authTokens: { getStoredToken: vi.fn().mockResolvedValue(null) }
}))
// Typed with both parameters so a test can read the options argument; the
// implementation only needs the first.
const createBrowserApp: Mock<(config: Record<string, unknown>, options?: unknown) => unknown> =
  vi.fn((config: Record<string, unknown>) => ({ shell: { config }, stores: {} }))
const resolveBrowserShellBootstrapConfig = vi.fn((options: Record<string, unknown>) => ({
  ...options
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  createBrowserShell,
  createBrowserApp,
  resolveBrowserShellBootstrapConfig
}))

const runtimeConfig = {
  edgeBaseUrl: 'https://edge.example',
  githubClientId: 'client-123',
  sentryDsn: undefined,
  sentryEnvironment: undefined,
  productBaseUrl: '/'
}

type CreateBrowserAppOptions = {
  appToolGroup?: { id: string; tools: { id: string }[] }
  appAssistantPolicy?: unknown
  starterPrompts?: readonly string[]
  documentGlobals: Record<string, boolean>
}

const optionsOfLastApp = (): CreateBrowserAppOptions =>
  createBrowserApp.mock.calls.at(-1)?.[1] as CreateBrowserAppOptions

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  createBrowserShell.mockImplementation(() => ({
    config: {},
    authTokens: { getStoredToken: vi.fn().mockResolvedValue(null) }
  }))
  createBrowserApp.mockImplementation((config: Record<string, unknown>) => ({
    shell: { config },
    stores: {}
  }))
  resolveBrowserShellBootstrapConfig.mockImplementation((options: Record<string, unknown>) => ({
    ...options
  }))
})

describe('ensureDocsAssistantApp', () => {
  it('creates the assistant app once and hands the same one back forever after', async () => {
    const { ensureDocsAssistantApp } = await import('../assistant-app')

    // Concurrent callers during one route…
    const [first, second] = await Promise.all([
      ensureDocsAssistantApp(runtimeConfig),
      ensureDocsAssistantApp(runtimeConfig)
    ])
    // …and a caller after several SPA navigations. `@theme/Root` never unmounts,
    // so this module-level memo is what makes it the SAME assistant, with the
    // same conversation, on every route.
    const third = await ensureDocsAssistantApp(runtimeConfig)

    expect(createBrowserApp).toHaveBeenCalledTimes(1)
    expect(first.app).toBe(second.app)
    expect(second.app).toBe(third.app)
  })

  it('owns a storage namespace shared with nothing else', async () => {
    const { ensureDocsAssistantApp } = await import('../assistant-app')
    await ensureDocsAssistantApp(runtimeConfig)

    const [config] = resolveBrowserShellBootstrapConfig.mock.calls[0]
    expect(config.storageNamespace).toBe(DOCS_ASSISTANT_STORAGE_NAMESPACE)
    // The three namespaces on this origin, all distinct: the product's default
    // ('tinytinkerer'), the labs', and the assistant's. Isolation is a property
    // of the database name, so this is where it is actually decided.
    expect(DOCS_ASSISTANT_STORAGE_NAMESPACE).not.toBe(DOCS_LAB_STORAGE_NAMESPACE)
    expect(DOCS_ASSISTANT_STORAGE_NAMESPACE).not.toBe('tinytinkerer')
  })

  it('borrows the product token read-only and never runs its own OAuth', async () => {
    const getStoredToken = vi.fn().mockResolvedValue('product-token')
    createBrowserShell.mockImplementationOnce(() => ({
      config: {},
      authTokens: { getStoredToken, setStoredToken: vi.fn(), clearStoredToken: vi.fn() }
    }))

    const { ensureDocsAssistantApp } = await import('../assistant-app')
    await ensureDocsAssistantApp(runtimeConfig)

    // The first shell is the read-only peek at the product's own default
    // namespace: no override, nothing written back.
    expect(createBrowserShell).toHaveBeenNthCalledWith(1, {})
    expect(getStoredToken).toHaveBeenCalledTimes(1)

    const [config] = resolveBrowserShellBootstrapConfig.mock.calls[0]
    expect(config.authMode).toBe('host-token')
    expect(config.hostToken).toBe('product-token')
  })

  it('reaches the shared anonymous quota when no product token exists', async () => {
    const { ensureDocsAssistantApp } = await import('../assistant-app')
    await ensureDocsAssistantApp(runtimeConfig)

    const [config] = resolveBrowserShellBootstrapConfig.mock.calls[0]
    // No token is not an error state: the edge serves anonymous callers from the
    // shared, rate-limited key, exactly as the labs and the product's own
    // surfaces do.
    expect(config.hostToken).toBeNull()
    expect(config.authMode).toBe('host-token')
  })

  it('carries the documentation tools, the grounding policy, and route-neutral starters', async () => {
    const { ensureDocsAssistantApp } = await import('../assistant-app')
    const { DOCS_ASSISTANT_STARTER_PROMPTS } = await import('../assistant-constants')
    await ensureDocsAssistantApp(runtimeConfig)

    const options = optionsOfLastApp()
    expect(options.appToolGroup?.id).toBe('documentation')
    expect(options.appToolGroup?.tools.map((tool) => tool.id)).toEqual([
      'search_docs',
      'read_doc',
      'read_current_doc'
    ])
    expect(options.appAssistantPolicy).toBeDefined()
    expect(options.starterPrompts).toBe(DOCS_ASSISTANT_STARTER_PROMPTS)
    // Route-neutral: every starter has to read correctly on /search and on a
    // 404, where there is no current document (#480 owns the route-aware ones).
    for (const prompt of DOCS_ASSISTANT_STARTER_PROMPTS) {
      expect(prompt.toLowerCase()).not.toMatch(/this (page|section|document)/)
    }
  })

  it('owns every document-global effect except the document head', async () => {
    const { ensureDocsAssistantApp } = await import('../assistant-app')
    await ensureDocsAssistantApp(runtimeConfig)

    expect(optionsOfLastApp().documentGlobals).toEqual({
      // Docusaurus owns the head; the assistant adds no second theme-color.
      brandMetadata: false,
      telemetry: true,
      contentRenderReporter: true,
      oauthCallbackWatchdog: true
    })
  })

  it('lets a retry genuinely retry after a failed bootstrap', async () => {
    createBrowserShell.mockImplementationOnce(() => {
      throw new Error('IndexedDB unavailable')
    })

    const { ensureDocsAssistantApp } = await import('../assistant-app')
    await expect(ensureDocsAssistantApp(runtimeConfig)).rejects.toThrow('IndexedDB unavailable')

    // The memo must not hold a rejected promise: a session that failed once
    // would otherwise re-resolve the same failure for as long as the reader
    // stayed on the site, while the status still advertised a retry.
    await expect(ensureDocsAssistantApp(runtimeConfig)).resolves.toBeDefined()
    expect(createBrowserApp).toHaveBeenCalledTimes(1)
  })
})
