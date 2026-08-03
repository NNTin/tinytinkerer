// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Two BrowserApps in one document (issue #479), against the REAL telemetry
 * module and the REAL settings store.
 *
 * The defect this pins down is not hypothetical: `initializeBrowserApp` restores
 * each app's OWN persisted `telemetryEnabled` and `setTelemetryEnabled` writes
 * module-global consent directly, so before the ownership split a live lab
 * carrying a stale `telemetryEnabled: true` would switch telemetry back on after
 * the assistant declined it — decided by nothing but boot order.
 *
 * Nothing here is mocked except plugin discovery and the `virtual:pwa-register`
 * build-time module. In particular the telemetry module is real: it never boots
 * Sentry under the `development` environment (see TELEMETRY_DISABLED_ENVIRONMENTS),
 * so consent, configuration and install identity can all be observed through
 * `getTelemetryHeaders()` — the same headers the edge would receive — without an
 * SDK anywhere near the test.
 */
vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: vi.fn().mockResolvedValue([])
}))

// The one substitution: Dexie needs an IndexedDB this environment does not
// have. Keyed BY STORAGE NAMESPACE, which is precisely the property under test —
// two apps, two databases, and no way for one to read the other's preferences.
const namespaces = vi.hoisted(() => new Map<string, Map<string, string>>())

const storeFor = (storageNamespace: string): Map<string, string> => {
  const existing = namespaces.get(storageNamespace)
  if (existing) return existing
  const created = new Map<string, string>()
  namespaces.set(storageNamespace, created)
  return created
}

vi.mock('../src/db.js', () => ({
  createBrowserPersistence: (storageNamespace: string) => {
    const store = storeFor(storageNamespace)
    return {
      preferences: {
        get: (key: string) => Promise.resolve(store.get(key)),
        set: (key: string, value: string) => {
          store.set(key, value)
          return Promise.resolve()
        }
      },
      conversations: {},
      authTokens: {
        getStoredToken: () => Promise.resolve(null),
        setStoredToken: () => Promise.resolve(),
        clearStoredToken: () => Promise.resolve()
      }
    }
  }
}))

import { TELEMETRY_HEADERS } from '@tinytinkerer/contracts'
import { createBrowserApp, initializeBrowserApp } from '../src/app.js'
import { getTelemetryHeaders, setTelemetryConsent } from '../src/telemetry/telemetry.js'

// Each app gets its own namespace, its own preferences, and — like the real
// thing — its own persisted install identity.
const ASSISTANT = {
  storageNamespace: 'tinytinkerer-docs-assistant',
  appVersion: 'assistant-build',
  installId: 'assistant-install-id'
}
const LAB = {
  storageNamespace: 'tinytinkerer-docs-lab',
  appVersion: 'lab-build',
  installId: 'lab-install-id'
}

/** Seeds an app's own namespace the way a returning visitor's would be. */
const seedNamespace = (
  app: typeof ASSISTANT,
  { telemetryEnabled }: { telemetryEnabled: boolean }
): void => {
  const store = storeFor(app.storageNamespace)
  store.set('telemetry_install_id', app.installId)
  if (telemetryEnabled) store.set('settings_telemetry_enabled', 'true')
}

const createApp = (app: typeof ASSISTANT, { owner }: { owner: boolean }) =>
  createBrowserApp(
    {
      storageNamespace: app.storageNamespace,
      appVersion: app.appVersion,
      buildHash: app.appVersion,
      sentryEnvironment: 'development'
    },
    {
      documentGlobals: {
        // Both docs apps leave the head to Docusaurus.
        brandMetadata: false,
        telemetry: owner,
        contentRenderReporter: owner,
        oauthCallbackWatchdog: owner
      }
    }
  )

beforeEach(async () => {
  // Module-global consent survives between tests in the same file — reset it the
  // way a real revocation would.
  await setTelemetryConsent(false)
  namespaces.clear()
  document.head.innerHTML = ''
})

describe('two BrowserApps in one document', () => {
  it('keeps consent off when the owner declined, whatever the lab persisted (assistant first)', async () => {
    seedNamespace(ASSISTANT, { telemetryEnabled: false })
    seedNamespace(LAB, { telemetryEnabled: true })
    const assistant = createApp(ASSISTANT, { owner: true })
    const lab = createApp(LAB, { owner: false })

    await initializeBrowserApp(assistant, {})
    await initializeBrowserApp(lab, {})

    // Consent off ⇒ no identifying header at all.
    expect(getTelemetryHeaders()).not.toHaveProperty(TELEMETRY_HEADERS.installId)
  })

  it('keeps consent off when the owner declined, whatever the lab persisted (lab first)', async () => {
    seedNamespace(ASSISTANT, { telemetryEnabled: false })
    seedNamespace(LAB, { telemetryEnabled: true })
    const assistant = createApp(ASSISTANT, { owner: true })
    const lab = createApp(LAB, { owner: false })

    // The order that used to decide the outcome.
    await initializeBrowserApp(lab, {})
    await initializeBrowserApp(assistant, {})

    expect(getTelemetryHeaders()).not.toHaveProperty(TELEMETRY_HEADERS.installId)
  })

  it('publishes the owner’s install identity and build, not the lab’s', async () => {
    seedNamespace(ASSISTANT, { telemetryEnabled: true })
    seedNamespace(LAB, { telemetryEnabled: true })
    const assistant = createApp(ASSISTANT, { owner: true })
    const lab = createApp(LAB, { owner: false })

    await initializeBrowserApp(lab, {})
    await initializeBrowserApp(assistant, {})

    const headers = getTelemetryHeaders()
    expect(headers[TELEMETRY_HEADERS.installId]).toBe(ASSISTANT.installId)
    expect(headers[TELEMETRY_HEADERS.appVersion]).toBe(ASSISTANT.appVersion)
    expect(headers[TELEMETRY_HEADERS.buildHash]).toBe(ASSISTANT.appVersion)
  })

  it('cannot be switched on from the lab’s own settings action', async () => {
    seedNamespace(ASSISTANT, { telemetryEnabled: false })
    seedNamespace(LAB, { telemetryEnabled: false })
    const assistant = createApp(ASSISTANT, { owner: true })
    const lab = createApp(LAB, { owner: false })
    await initializeBrowserApp(assistant, {})
    await initializeBrowserApp(lab, {})

    await lab.stores.settings.getState().setTelemetryEnabled(true)

    expect(getTelemetryHeaders()).not.toHaveProperty(TELEMETRY_HEADERS.installId)
    // …and the non-owner did not quietly persist a value nothing acts on.
    expect(lab.stores.settings.getState().telemetryEnabled).toBe(false)

    // The owner's own action still works, and publishes the owner's identity.
    await assistant.stores.settings.getState().setTelemetryEnabled(true)
    expect(getTelemetryHeaders()[TELEMETRY_HEADERS.installId]).toBe(ASSISTANT.installId)
  })

  it('stays owner-owned when the lab app boots once per mounted lab, not once per app', async () => {
    // The REAL documentation topology (issue #482, finding 3), which the cases
    // above under-modelled by initializing each app exactly once.
    //
    // A page carrying several <LiveLab>s has ONE lab BrowserApp — the module
    // singleton in live-lab/client-runtime.tsx — but each lab renders its own
    // BrowserAppShell, and every shell runs `initializeBrowserApp` through
    // `useBrowserAppBootstrap`. So the non-owner's boot restore does not run
    // once; it runs once per lab on the page, interleaved with the assistant's.
    //
    // Modelling that as three independent apps would have been wrong in the
    // direction that matters: three apps have three namespaces and three
    // install identities, while the real case is one namespace re-restoring the
    // SAME stale `telemetryEnabled: true` several times against one global
    // consent flag.
    seedNamespace(ASSISTANT, { telemetryEnabled: false })
    seedNamespace(LAB, { telemetryEnabled: true })
    const assistant = createApp(ASSISTANT, { owner: true })
    const lab = createApp(LAB, { owner: false })

    // Three labs and the assistant, in the order Docusaurus would mount them:
    // the page's labs first, then the runtime host once a reader activates it.
    await initializeBrowserApp(lab, {})
    await initializeBrowserApp(lab, {})
    await initializeBrowserApp(lab, {})
    await initializeBrowserApp(assistant, {})
    // …and a fourth lab appearing after activation, which SPA navigation makes
    // ordinary rather than exotic.
    await initializeBrowserApp(lab, {})

    expect(getTelemetryHeaders()).not.toHaveProperty(TELEMETRY_HEADERS.installId)

    // The lab's OWN hydrated value is still the `true` its namespace persisted —
    // and that is correct, not a leak. Ownership is enforced at the two places
    // that reach module-global consent (`app.ts`'s boot restore and the settings
    // action), not by rewriting a non-owner's local preference. What keeps it
    // from becoming a toggle that appears to work and does nothing is that the
    // non-owner's Privacy section is not rendered at all.
    expect(lab.stores.settings.getState().telemetryEnabled).toBe(true)
    expect(lab.documentGlobals.telemetry).toBe(false)
    await lab.stores.settings.getState().setTelemetryEnabled(true)
    expect(getTelemetryHeaders()).not.toHaveProperty(TELEMETRY_HEADERS.installId)

    // The owner still owns it after all that, and publishes its own identity.
    await assistant.stores.settings.getState().setTelemetryEnabled(true)
    expect(getTelemetryHeaders()[TELEMETRY_HEADERS.installId]).toBe(ASSISTANT.installId)

    // A late lab mount must not undo the decision the owner just made — this is
    // the same defect as the boot-order one, arriving after boot.
    await initializeBrowserApp(lab, {})
    expect(getTelemetryHeaders()[TELEMETRY_HEADERS.installId]).toBe(ASSISTANT.installId)
  })

  it('injects no TinyTinkerer-managed head element for either app', async () => {
    seedNamespace(ASSISTANT, { telemetryEnabled: false })
    seedNamespace(LAB, { telemetryEnabled: false })
    const assistant = createApp(ASSISTANT, { owner: true })
    const lab = createApp(LAB, { owner: false })

    await initializeBrowserApp(assistant, {})
    await initializeBrowserApp(lab, {})

    // Docusaurus owns the documentation site's head: no managed theme-color, no
    // manifest, no icons — not from the assistant, and not from a lab.
    expect(document.head.querySelectorAll('[data-tinytinkerer-brand]')).toHaveLength(0)
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull()
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull()
  })
})
