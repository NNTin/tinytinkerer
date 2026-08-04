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

// Plugin-derived behaviour is exercised by tool-tree.test.tsx and the
// create-runtime tests; this suite only needs an app that starts, so it carries
// no plugins.
import { createBrowserApp, initializeBrowserApp } from '../src/app.js'
import { noPlugins } from './plugin-catalogue-fixture'

// Retargeted from `bootstrapBrowserShell` (issue #495). That export was a fourth
// `createBrowserApp` construction path with no caller anywhere in the monorepo —
// app-browser is `private: true` with no `files`, so there was no external
// consumer either — and it was deleted rather than threaded with a plugin
// catalogue it would never use.
//
// The BEHAVIOUR it pinned is worth keeping and is asserted here instead: startup
// initializes auth and settings, and deliberately not chat or status. That is
// now tested against the path production actually takes (`createBrowserApp` +
// `initializeBrowserApp`, reached through `useBrowserAppBootstrap` in
// `bootstrap.ts` and `BrowserAppShell`), rather than through a facade nobody
// called — the same shape document-globals.test.ts, branding.test.ts and
// content-render-reporter.test.ts already use.
describe('browser app startup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a browser app instance and initializes only startup-critical stores', async () => {
    const config = {
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'tinytinkerer-test',
      githubClientId: 'github-client-id'
    }
    const app = createBrowserApp(config, { plugins: noPlugins })
    await initializeBrowserApp(app, config)

    expect(app.shell.config).toMatchObject(config)
    expect(authInitialize).toHaveBeenCalledTimes(1)
    expect(settingsInitialize).toHaveBeenCalledTimes(1)
    expect(chatInitialize).not.toHaveBeenCalled()
    expect(statusInitialize).not.toHaveBeenCalled()
  })
})
