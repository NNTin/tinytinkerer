// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockShell = vi.hoisted(() => ({
  config: {
    edgeBaseUrl: 'http://edge.local',
    storageNamespace: 'tinytinkerer-test',
    authMode: 'hybrid' as const,
    hostToken: null
  },
  conversations: {},
  preferences: {},
  authTokens: {},
  statusGateway: {}
}))

const initializeStore = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@tinytinkerer/brand-assets', () => ({
  TINYTINKERER_BRAND: {
    theme: {
      applicationName: 'tinytinkerer',
      themeColor: '#f6f2ec',
      backgroundColor: '#fffaf5'
    },
    links: [
      { rel: 'icon', href: '/assets/favicon.ico', type: 'image/x-icon' },
      { rel: 'icon', href: '/assets/favicon-16.png', type: 'image/png', sizes: '16x16' },
      { rel: 'icon', href: '/assets/favicon-32.png', type: 'image/png', sizes: '32x32' },
      { rel: 'icon', href: '/assets/favicon-48.png', type: 'image/png', sizes: '48x48' },
      {
        rel: 'apple-touch-icon',
        href: '/assets/apple-touch-icon-180.png',
        type: 'image/png',
        sizes: '180x180'
      }
    ],
    manifest: {
      name: 'tinytinkerer',
      shortName: 'tinytinkerer',
      description:
        'TinyTinkerer app icons and branding metadata for web, widget, and future mobile shells.',
      startUrl: '/',
      display: 'standalone',
      backgroundColor: '#fffaf5',
      themeColor: '#f6f2ec',
      icons: [
        { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: '/assets/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    }
  }
}))

vi.mock('../src/shell.js', () => ({
  createBrowserShell: vi.fn(() => mockShell)
}))

vi.mock('../src/stores/auth-store.js', () => ({
  createAuthStore: vi.fn(() => ({
    getState: () => ({ initialize: initializeStore })
  }))
}))

vi.mock('../src/stores/chat-store.js', () => ({
  createChatStore: vi.fn(() => ({
    getState: () => ({ initialize: initializeStore })
  }))
}))

vi.mock('../src/stores/settings-store.js', () => ({
  createSettingsStore: vi.fn(() => ({
    getState: () => ({ initialize: initializeStore })
  }))
}))

vi.mock('../src/stores/status-store.js', () => ({
  createStatusStore: vi.fn(() => ({
    getState: () => ({ initialize: initializeStore })
  }))
}))

import { createBrowserApp, initializeBrowserApp } from '../src/index.js'

const decodeDataUrlPayload = (value: string): string =>
  decodeURIComponent(value.split(',')[1] ?? '')

describe('brand metadata', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta charset="UTF-8" />'
    vi.clearAllMocks()
  })

  it('applies shared icon, manifest, and theme metadata during app creation', async () => {
    const app = createBrowserApp({ manifestStartUrl: '/web/' })
    await initializeBrowserApp(app, { manifestStartUrl: '/web/' })

    expect(document.head.querySelectorAll('link[rel="icon"]').length).toBe(4)
    expect(
      document.head.querySelector('link[rel="icon"][type="image/x-icon"]')?.getAttribute('href')
    ).toBe('/assets/favicon.ico')
    expect(
      document.head.querySelector('link[rel="icon"][sizes="16x16"]')?.getAttribute('href')
    ).toBe('/assets/favicon-16.png')
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).toBeTruthy()
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#f6f2ec'
    )

    const manifestHref = document.head.querySelector('link[rel="manifest"]')?.getAttribute('href')
    expect(manifestHref).toMatch(/^data:application\/manifest\+json/)
    expect(JSON.parse(decodeDataUrlPayload(manifestHref ?? ''))).toMatchObject({
      name: 'tinytinkerer',
      short_name: 'tinytinkerer',
      display: 'standalone',
      start_url: '/web/'
    })
  })

  it('reuses managed head tags when multiple browser apps are created', async () => {
    await initializeBrowserApp(createBrowserApp({}), {})
    await initializeBrowserApp(createBrowserApp({}), {})

    expect(document.head.querySelectorAll('[data-tinytinkerer-brand]').length).toBe(9)
    expect(document.head.querySelectorAll('link[rel="manifest"]').length).toBe(1)
    expect(document.head.querySelectorAll('link[rel="icon"]').length).toBe(4)
    expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(1)
  })

  it('preserves an existing external manifest link', async () => {
    document.head.innerHTML =
      '<meta charset="UTF-8" /><link rel="manifest" href="/mobile/manifest.webmanifest" />'

    const app = createBrowserApp({})
    await initializeBrowserApp(app, {})

    expect(
      document.head
        .querySelector('link[rel="manifest"]:not([data-tinytinkerer-brand])')
        ?.getAttribute('href')
    ).toBe('/mobile/manifest.webmanifest')
    expect(
      document.head.querySelector('link[rel="manifest"][data-tinytinkerer-brand="manifest"]')
    ).toBeNull()
  })
})
