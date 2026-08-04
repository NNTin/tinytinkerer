// The ONE module in this framework that imports the product runtime for real.
// It must only ever be reached through a dynamic import() (see LiveLab.tsx's
// `React.lazy`, itself gated behind Docusaurus's <BrowserOnly>) so a page with no
// <LiveLab> never downloads this chunk, and a static build never executes it.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BrowserAppShell,
  NO_GLOBAL_HOST_CAPABILITIES,
  useAuthStore,
  useChatCooldown,
  useChatStore,
  type BrowserApp,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import '@tinytinkerer/app-browser/styles.css'
import { createDocsBrowserApp } from '../docs-runtime/create-docs-app'
import { beginDocsProductSignIn } from '../docs-runtime/product-sign-in'
import type { DocsRuntimeConfig } from '../docs-runtime/runtime-config'
import { useDocsRuntimeConfig } from '../docs-runtime/runtime-config'
import { deleteDocsStorageNamespace } from '../docs-runtime/storage'
import { DOCS_LAB_PLUGINS } from '../docs-runtime/plugin-catalogue'
import { DOCS_LAB_STORAGE_NAMESPACE } from './constants'
import { deriveLabSessionSnapshot, LabSessionContext } from './lab-session-context'
import { pluginToolPickerDemoToolGroup } from './plugin-tool-picker/demo-tools'

type DocsLabApp = { app: BrowserApp; config: BrowserShellConfig }

// Module-level singleton (issue #451 acceptance: "multiple labs on one page share
// one isolated docs session"). Every <LiveLab> instance on the page calls
// `ensureDocsLabApp`, but the underlying BrowserApp — and therefore its auth,
// chat, and settings stores — is created at most once per page load.
let sharedAppPromise: Promise<DocsLabApp> | null = null

export const ensureDocsLabApp = (runtimeConfig: DocsRuntimeConfig): Promise<DocsLabApp> => {
  sharedAppPromise ??= createDocsBrowserApp({
    storageNamespace: DOCS_LAB_STORAGE_NAMESPACE,
    runtimeConfig,
    // The labs' own plugins (issue #495) — the assistant's two plus code
    // execution, because this is the surface where the documentation
    // demonstrates the plugin system rather than the one answering questions
    // under #478's grounding policy. See ../docs-runtime/plugin-catalogue.ts.
    // This is already inside a lazily-imported client runtime; the dynamic
    // import keeps each plugin in its own chunk besides.
    plugins: () => import('@tinytinkerer/catalogue').then((m) => m.loadPlugins(DOCS_LAB_PLUGINS)),
    // Nothing in this catalogue requests human input: choice-prompt and
    // permissions are deliberately excluded, so no lab can raise a prompt and no
    // lab shell mounts a renderer for one.
    humanInput: false,
    // The docs app's own intrinsic tool group (issue #453) — exactly the
    // mechanism apps/canvas/apps/mermaid use for their real stage tools, not a
    // simulation. Attached to the ONE shared docs-lab BrowserApp, so it is
    // available to every LiveLab on the page, same as any other app's always-on
    // tools would be — there is no plugin here, so no activation gate. The
    // assistant's Documentation tools are deliberately NOT here (issue #479):
    // they belong to the assistant session alone.
    appToolGroup: pluginToolPickerDemoToolGroup,
    // A live lab owns no document-global effect (issue #479). The global
    // assistant at @theme/Root owns them all for the documentation site, which
    // is why this is structural rather than a race the first lab to mount wins:
    // a lab must not configure telemetry, publish an install identity, restore
    // its own persisted consent over the assistant's, register the
    // content-render sink, arm the OAuth watchdog, or touch the document head.
    documentGlobals: {
      brandMetadata: false,
      telemetry: false,
      contentRenderReporter: false,
      oauthCallbackWatchdog: false
    }
  }).catch((error: unknown) => {
    sharedAppPromise = null
    throw error
  })
  return sharedAppPromise
}

// Clears ONLY the isolated docs-lab IndexedDB database (conversations, plugin
// settings, model selection) and reloads. Never touches the product's own
// database or token — those live under a different IndexedDB database name
// entirely (see createDocsBrowserApp's read-only peek at it).
//
// The reload stays a LAB behaviour: a lab lives inside one page, so restarting
// that page is a proportionate way to rebuild its stores. The global assistant
// resets its conversation in place instead (issue #479) — reloading the
// documentation out from under a reader would not be.
export const resetDocsLabSession = async (): Promise<void> => {
  await deleteDocsStorageNamespace(DOCS_LAB_STORAGE_NAMESPACE)
  sharedAppPromise = null
  window.location.reload()
}

const DocsLabBootScreen = ({ error }: { error?: string }) => (
  <p role="status">
    {error ? `Live lab failed to start: ${error}` : 'Preparing the live lab session…'}
  </p>
)

const SessionBridge = ({
  isResetting,
  signIn,
  reset,
  children
}: {
  isResetting: boolean
  signIn: () => void
  reset: () => Promise<void>
  children: ReactNode
}) => {
  const token = useAuthStore((state) => state.token)
  const isRunning = useChatStore((state) => state.isRunning)
  const cooldownUntil = useChatStore((state) => state.cooldownUntil)
  const { isCoolingDown } = useChatCooldown()

  const snapshot = useMemo(
    () =>
      deriveLabSessionSnapshot({
        isResetting,
        isCoolingDown,
        cooldownUntil: cooldownUntil ?? null,
        isRunning,
        token
      }),
    [isResetting, isCoolingDown, isRunning, token, cooldownUntil]
  )

  const value = useMemo(() => ({ snapshot, signIn, reset }), [snapshot, signIn, reset])

  return <LabSessionContext.Provider value={value}>{children}</LabSessionContext.Provider>
}

type AppState =
  | { phase: 'loading' }
  | { phase: 'ready'; app: BrowserApp; config: BrowserShellConfig }
  | { phase: 'error'; message: string }

export type ClientRuntimeProps = { children: ReactNode }

// The client-only tree every <LiveLab> mounts (via LiveLab.tsx's BrowserOnly +
// React.lazy boundary). Resolves the shared docs-lab BrowserApp, then defers to
// BrowserAppShell for the SAME bootstrap/error-boundary tree every other
// TinyTinkerer surface uses.
//
// It mounts NO document-global host (issue #479). The privacy/telemetry consent
// behaviour issue #451 asked for is retained, but it is now owned once for the
// whole documentation site by the assistant runtime host at @theme/Root instead
// of by whichever lab happened to mount first — which is what lets a page carry
// several labs beside the assistant with one consent dialog between them.
export default function ClientRuntime({ children }: ClientRuntimeProps) {
  const runtimeConfig = useDocsRuntimeConfig()
  const [appState, setAppState] = useState<AppState>({ phase: 'loading' })
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ensureDocsLabApp(runtimeConfig)
      .then(({ app, config }) => {
        if (!cancelled) {
          setAppState({ phase: 'ready', app, config })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAppState({
            phase: 'error',
            message:
              error instanceof Error ? error.message : 'Failed to start the live lab session.'
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [runtimeConfig])

  const signIn = useCallback(() => {
    beginDocsProductSignIn(runtimeConfig)
  }, [runtimeConfig])

  const reset = useCallback(async () => {
    setIsResetting(true)
    await resetDocsLabSession()
  }, [])

  if (appState.phase === 'loading') {
    return (
      <LabSessionContext.Provider
        value={{
          snapshot: { status: isResetting ? 'reset' : 'loading', error: null, retryAt: null },
          signIn,
          reset
        }}
      >
        {children}
      </LabSessionContext.Provider>
    )
  }

  if (appState.phase === 'error') {
    return (
      <LabSessionContext.Provider
        value={{
          snapshot: { status: 'error', error: appState.message, retryAt: null },
          signIn,
          reset
        }}
      >
        {children}
      </LabSessionContext.Provider>
    )
  }

  return (
    <BrowserAppShell
      app={appState.app}
      config={appState.config}
      BootScreen={DocsLabBootScreen}
      globalHosts={NO_GLOBAL_HOST_CAPABILITIES}
    >
      <SessionBridge isResetting={isResetting} signIn={signIn} reset={reset}>
        {children}
      </SessionBridge>
    </BrowserAppShell>
  )
}
