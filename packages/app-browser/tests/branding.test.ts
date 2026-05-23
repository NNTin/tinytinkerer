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
      { rel: 'icon', href: 'data:image/svg+xml,icon', type: 'image/svg+xml', sizes: 'any' },
      {
        rel: 'apple-touch-icon',
        href: 'data:image/svg+xml,apple',
        type: 'image/svg+xml',
        sizes: '180x180'
      },
      {
        rel: 'mask-icon',
        href: 'data:image/svg+xml,mask',
        type: 'image/svg+xml',
        color: '#25231d'
      }
    ],
    manifest: {
      name: 'tinytinkerer',
      shortName: 'tinker',
      description: 'Placeholder PWA metadata for TinyTinkerer.',
      startUrl: '/',
      display: 'standalone',
      backgroundColor: '#fffaf5',
      themeColor: '#f6f2ec',
      icons: [{ src: 'data:image/svg+xml,icon', sizes: '512x512', type: 'image/svg+xml' }]
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

import { createBrowserApp } from '../src/index.js'

const decodeDataUrlPayload = (value: string): string => decodeURIComponent(value.split(',')[1] ?? '')

describe('brand metadata', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta charset="UTF-8" />'
    vi.clearAllMocks()
  })

  it('applies shared icon, manifest, and theme metadata during app creation', async () => {
    await createBrowserApp({})

    expect(document.head.querySelector('link[rel="icon"]')?.getAttribute('href')).toMatch(
      /^data:image\/svg\+xml/
    )
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).toBeTruthy()
    expect(document.head.querySelector('link[rel="mask-icon"]')).toBeTruthy()
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#f6f2ec'
    )

    const manifestHref = document.head.querySelector('link[rel="manifest"]')?.getAttribute('href')
    expect(manifestHref).toMatch(/^data:application\/manifest\+json/)
    expect(JSON.parse(decodeDataUrlPayload(manifestHref ?? ''))).toMatchObject({
      name: 'tinytinkerer',
      short_name: 'tinker',
      display: 'standalone'
    })
  })

  it('reuses managed head tags when multiple browser apps are created', async () => {
    await createBrowserApp({})
    await createBrowserApp({})

    expect(document.head.querySelectorAll('[data-tinytinkerer-brand]').length).toBe(7)
    expect(document.head.querySelectorAll('link[rel="manifest"]').length).toBe(1)
    expect(document.head.querySelectorAll('link[rel="icon"]').length).toBe(1)
    expect(document.head.querySelectorAll('meta[name="theme-color"]').length).toBe(1)
  })
})
