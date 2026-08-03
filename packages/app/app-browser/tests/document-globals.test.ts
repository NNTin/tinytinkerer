import { beforeEach, describe, expect, it, vi } from 'vitest'

// The document-global ownership split (issue #479): a document may hold more
// than one BrowserApp, and exactly one of them may own the effects that write
// to state there is only one of — the <head>, the telemetry module's
// configuration/consent/identity, and the content-render error sink.
//
// Every collaborator below is mocked because each one IS the module-global
// state under test; asserting on the calls is the only way to see "the second
// app did not do this" without booting Sentry or mutating the real document.
const applyBrandMetadata = vi.hoisted(() => vi.fn())
const configureTelemetry = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const setTelemetryConsent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const setContentRenderErrorReporter = vi.hoisted(() => vi.fn())

vi.mock('../src/branding.js', () => ({ applyBrandMetadata }))

vi.mock('../src/telemetry/telemetry.js', () => ({
  configureTelemetry,
  setTelemetryConsent,
  captureTelemetryException: vi.fn(),
  fingerprintMessage: (message: string) => message
}))

vi.mock('@tinytinkerer/content-react', () => ({ setContentRenderErrorReporter }))

vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: vi.fn().mockResolvedValue([])
}))

const telemetryEnabled = vi.hoisted(() => ({ current: true }))

const authInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../src/stores/auth-store.js', () => ({
  createAuthStore: vi.fn(() => ({ getState: () => ({ initialize: authInitialize }) }))
}))
vi.mock('../src/stores/chat-store.js', () => ({ createChatStore: vi.fn(() => ({})) }))
vi.mock('../src/stores/status-store.js', () => ({ createStatusStore: vi.fn(() => ({})) }))
vi.mock('../src/stores/inspector-store.js', () => ({ createInspectorStore: vi.fn(() => ({})) }))
vi.mock('../src/stores/settings-store.js', () => ({
  createSettingsStore: vi.fn(() => ({
    getState: () => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      reconcilePluginTools: vi.fn().mockResolvedValue(undefined),
      // A returning visitor who previously opted in, in THIS app's namespace.
      get telemetryEnabled() {
        return telemetryEnabled.current
      }
    })
  }))
}))

vi.mock('../src/shell.js', () => ({
  createBrowserShell: vi.fn(() => ({
    config: {
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'test',
      authMode: 'hybrid',
      hostToken: null,
      sentryEnvironment: 'development',
      appVersion: 'test',
      buildHash: 'test'
    },
    preferences: {},
    conversations: {},
    authTokens: {},
    statusGateway: {}
  }))
}))

import { createBrowserApp, initializeBrowserApp } from '../src/app.js'
import {
  DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES,
  NO_GLOBAL_HOST_CAPABILITIES,
  resolveDocumentGlobalCapabilities,
  resolveGlobalHostCapabilities
} from '../src/document-globals.js'

beforeEach(() => {
  vi.clearAllMocks()
  telemetryEnabled.current = true
})

describe('document-global capability defaults', () => {
  it('owns everything when nothing is specified, so a single-app document is unchanged', () => {
    expect(resolveDocumentGlobalCapabilities()).toEqual(DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES)
    expect(resolveDocumentGlobalCapabilities()).toEqual({
      brandMetadata: true,
      telemetry: true,
      contentRenderReporter: true,
      oauthCallbackWatchdog: true
    })
    // The human-in-the-loop modal is deliberately absent from this set (issue
    // #489 review): it is app-scoped, not document-global, and lives on
    // `app.stores.humanPrompts`. See human-prompt-host-ownership.test.tsx.
    expect(resolveGlobalHostCapabilities()).toEqual({
      telemetryConsent: true,
      privacyUpdate: true,
      konami: true
    })
  })

  it('overrides only the named capability', () => {
    expect(resolveDocumentGlobalCapabilities({ telemetry: false })).toEqual({
      brandMetadata: true,
      telemetry: false,
      contentRenderReporter: true,
      oauthCallbackWatchdog: true
    })
    expect(resolveGlobalHostCapabilities({ konami: false })).toEqual({
      telemetryConsent: true,
      privacyUpdate: true,
      konami: false
    })
    expect(NO_GLOBAL_HOST_CAPABILITIES).toEqual({
      telemetryConsent: false,
      privacyUpdate: false,
      konami: false
    })
  })

  it('resolves the capabilities onto the app itself', () => {
    const owner = createBrowserApp({})
    const guest = createBrowserApp({}, { documentGlobals: { telemetry: false } })

    expect(owner.documentGlobals).toEqual(DEFAULT_DOCUMENT_GLOBAL_CAPABILITIES)
    expect(guest.documentGlobals.telemetry).toBe(false)
    expect(guest.documentGlobals.contentRenderReporter).toBe(true)
  })
})

describe('initializeBrowserApp document-global effects', () => {
  it('runs every document-global effect for an owner', async () => {
    await initializeBrowserApp(createBrowserApp({}), {})

    expect(applyBrandMetadata).toHaveBeenCalledTimes(1)
    expect(configureTelemetry).toHaveBeenCalledTimes(1)
    expect(setContentRenderErrorReporter).toHaveBeenCalledTimes(1)
    expect(setTelemetryConsent).toHaveBeenCalledWith(true)
  })

  it('skips every disabled document-global effect for a non-owner', async () => {
    const guest = createBrowserApp(
      {},
      {
        documentGlobals: {
          brandMetadata: false,
          telemetry: false,
          contentRenderReporter: false,
          oauthCallbackWatchdog: false
        }
      }
    )

    await initializeBrowserApp(guest, {})

    expect(applyBrandMetadata).not.toHaveBeenCalled()
    expect(configureTelemetry).not.toHaveBeenCalled()
    expect(setContentRenderErrorReporter).not.toHaveBeenCalled()
    // The heart of it: a stale persisted `telemetryEnabled: true` in a
    // non-owner's own namespace must not switch the document's telemetry back
    // on over the owner's decision.
    expect(setTelemetryConsent).not.toHaveBeenCalled()
  })

  it('still runs per-instance initialization for a non-owner', async () => {
    const guest = createBrowserApp({}, { documentGlobals: { telemetry: false } })

    await initializeBrowserApp(guest, {})

    // Auth/settings hydration is per-app and never owned by anybody else.
    expect(authInitialize).toHaveBeenCalled()
    expect(configureTelemetry).not.toHaveBeenCalled()
  })

  it('leaves consent alone for an owner who never opted in', async () => {
    telemetryEnabled.current = false

    await initializeBrowserApp(createBrowserApp({}), {})

    expect(configureTelemetry).toHaveBeenCalledTimes(1)
    expect(setTelemetryConsent).not.toHaveBeenCalled()
  })
})
