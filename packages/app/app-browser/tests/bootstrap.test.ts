import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockShell = vi.hoisted(() => ({
  config: {
    edgeBaseUrl: 'http://edge.local',
    storageNamespace: 'tinytinkerer-test',
    authMode: 'hybrid' as const,
    githubClientId: 'github-client-id',
    hostToken: null
  },
  conversations: {},
  preferences: {},
  authTokens: {},
  statusGateway: {}
}))

const authInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const chatInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const settingsInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const statusInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
// Discovery-time reconciliation (issue #400 review, F2/F3) fires from
// initializeBrowserApp right after settings hydrate — this mocked store needs
// the action too, or the fire-and-forget call throws an unhandled rejection.
const reconcilePluginTools = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@tinytinkerer/brand-assets', () => ({
  TINYTINKERER_BRAND: {
    theme: {
      applicationName: 'tinytinkerer',
      themeColor: '#f6f2ec',
      backgroundColor: '#fffaf5'
    },
    links: [{ rel: 'icon', href: 'data:image/svg+xml,test' }],
    manifest: {
      name: 'tinytinkerer',
      shortName: 'tinker',
      startUrl: '/',
      display: 'standalone',
      backgroundColor: '#fffaf5',
      themeColor: '#f6f2ec',
      icons: [{ src: 'data:image/svg+xml,test', sizes: '512x512', type: 'image/svg+xml' }]
    }
  }
}))

vi.mock('../src/shell.js', () => ({
  createBrowserShell: vi.fn(() => mockShell)
}))

vi.mock('../src/stores/auth-store.js', () => ({
  createAuthStore: vi.fn(() => ({
    getState: () => ({ initialize: authInitialize })
  }))
}))

vi.mock('../src/stores/chat-store.js', () => ({
  createChatStore: vi.fn(() => ({
    getState: () => ({ initialize: chatInitialize })
  }))
}))

vi.mock('../src/stores/settings-store.js', () => ({
  createSettingsStore: vi.fn(() => ({
    getState: () => ({ initialize: settingsInitialize, reconcilePluginTools })
  }))
}))

vi.mock('../src/stores/status-store.js', () => ({
  createStatusStore: vi.fn(() => ({
    getState: () => ({ initialize: statusInitialize })
  }))
}))

// Discovery is exercised by tool-tree.test.tsx and create-runtime tests; this
// bootstrap test only needs to prove initializeBrowserApp doesn't crash before
// hydration completes, so it stubs discovery to an empty plugin set.
vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: vi.fn().mockResolvedValue([])
}))

import { bootstrapBrowserShell } from '../src/initialize.js'

describe('bootstrapBrowserShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a browser app instance and initializes only startup-critical stores', async () => {
    const app = await bootstrapBrowserShell({
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      githubClientId: 'github-client-id'
    })

    expect(app.shell.config).toMatchObject({
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      githubClientId: 'github-client-id'
    })
    expect(authInitialize).toHaveBeenCalledTimes(1)
    expect(settingsInitialize).toHaveBeenCalledTimes(1)
    expect(chatInitialize).not.toHaveBeenCalled()
    expect(statusInitialize).not.toHaveBeenCalled()
  })
})
