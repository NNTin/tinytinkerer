// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Telemetry is mocked so we can assert what the content-render sink forwards
// without booting the Sentry SDK. `fingerprintMessage` is passed through
// unchanged so the assertion can compare the raw message.
const captureTelemetryException = vi.hoisted(() => vi.fn())

vi.mock('../src/telemetry/telemetry.js', () => ({
  captureTelemetryException,
  captureTelemetryMessage: vi.fn(),
  configureTelemetry: vi.fn().mockResolvedValue(undefined),
  setTelemetryConsent: vi.fn().mockResolvedValue(undefined),
  fingerprintMessage: (message: string) => message
}))

const initializeStore = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const mockShell = vi.hoisted(() => ({
  config: {
    sentryEnvironment: 'production',
    appVersion: 'test',
    buildHash: 'test'
  },
  preferences: {}
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
    getState: () => ({ initialize: initializeStore, telemetryEnabled: false })
  }))
}))

vi.mock('../src/stores/status-store.js', () => ({
  createStatusStore: vi.fn(() => ({
    getState: () => ({ initialize: initializeStore })
  }))
}))

import { reportContentRenderError } from '@tinytinkerer/content-react'
import { createBrowserApp, initializeBrowserApp } from '../src/index.js'

describe('content render reporter wiring', () => {
  beforeEach(() => {
    document.head.innerHTML = '<meta charset="UTF-8" />'
    vi.clearAllMocks()
  })

  it('routes a content render failure to telemetry once initialized', async () => {
    const app = createBrowserApp({})
    await initializeBrowserApp(app, {})

    // A content node that fails immediately after init — the sink must be
    // registered (synchronously, not behind an async import) so this is not
    // dropped.
    const error = new Error('render exploded')
    reportContentRenderError(error, {
      reason: 'renderFailed',
      nodeType: 'codeBlock',
      pluginId: 'mermaid'
    })

    expect(captureTelemetryException).toHaveBeenCalledTimes(1)
    const call = captureTelemetryException.mock.calls[0]
    expect(call?.[0]).toBe(error)
    expect(call?.[1]).toMatchObject({
      level: 'error',
      tags: {
        source: 'content-render',
        content_render_reason: 'renderFailed',
        content_node_type: 'codeBlock',
        content_plugin: 'mermaid'
      },
      fingerprint: ['content-render', 'renderFailed', 'mermaid', 'render exploded']
    })
  })

  it('forwards a loadFailed report with its reason tag and fingerprint', async () => {
    const app = createBrowserApp({})
    await initializeBrowserApp(app, {})

    reportContentRenderError(new Error('chunk load failed'), {
      reason: 'loadFailed',
      nodeType: 'codeBlock',
      pluginId: 'wireframe'
    })

    expect(captureTelemetryException).toHaveBeenCalledTimes(1)
    expect(captureTelemetryException.mock.calls[0]?.[1]).toMatchObject({
      tags: { content_render_reason: 'loadFailed', content_plugin: 'wireframe' },
      fingerprint: ['content-render', 'loadFailed', 'wireframe', 'chunk load failed']
    })
  })
})
