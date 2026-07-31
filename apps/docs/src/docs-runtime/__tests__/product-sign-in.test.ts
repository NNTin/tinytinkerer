import { beforeEach, describe, expect, it, vi } from 'vitest'

// Moved here from live-lab/__tests__/client-runtime.test.ts when #479 extracted
// sign-in for both docs surfaces. The behaviour under test is unchanged: the
// assistant and the labs must send a signed-out visitor to the SAME product
// login, under the product's own namespace.
const createBrowserShell = vi.fn((config: Record<string, unknown>) => ({ config }))
const resolveBrowserShellBootstrapConfig = vi.fn((options: Record<string, unknown>) => ({
  ...options
}))
const canStartGitHubOAuth = vi.fn(() => true)
const startGitHubOAuth = vi.fn()

vi.mock('@tinytinkerer/app-browser', () => ({
  createBrowserShell,
  resolveBrowserShellBootstrapConfig,
  canStartGitHubOAuth,
  startGitHubOAuth
}))

const runtimeConfig = {
  edgeBaseUrl: 'https://edge.example',
  githubClientId: 'client-123',
  sentryDsn: undefined,
  sentryEnvironment: undefined,
  productBaseUrl: '/pr-7/'
}

describe('beginDocsProductSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    canStartGitHubOAuth.mockReturnValue(true)
    resolveBrowserShellBootstrapConfig.mockImplementation((options: Record<string, unknown>) => ({
      ...options
    }))
  })

  it('uses the PRODUCT default namespace (no override) so the callback route can find its state', async () => {
    const { beginDocsProductSignIn } = await import('../product-sign-in')
    const started = beginDocsProductSignIn(runtimeConfig)

    expect(started).toBe(true)
    const [signInOptions] = resolveBrowserShellBootstrapConfig.mock.calls[0]
    expect(signInOptions.storageNamespace).toBeUndefined()
    expect(signInOptions.authMode).toBe('oauth')
    expect(signInOptions.baseUrl).toBe(runtimeConfig.productBaseUrl)
    expect(startGitHubOAuth).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when OAuth is not configured for this deployment', async () => {
    canStartGitHubOAuth.mockReturnValue(false)
    const { beginDocsProductSignIn } = await import('../product-sign-in')

    expect(beginDocsProductSignIn(runtimeConfig)).toBe(false)
    expect(startGitHubOAuth).not.toHaveBeenCalled()
  })
})
