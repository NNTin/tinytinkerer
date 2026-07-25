// The ONE module in this framework that imports the product runtime for real.
// It must only ever be reached through a dynamic import() (see LiveLab.tsx's
// `React.lazy`, itself gated behind Docusaurus's <BrowserOnly>) so a page with no
// <LiveLab> never downloads this chunk, and a static build never executes it.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BrowserAppShell,
  createBrowserApp,
  createBrowserShell,
  canStartGitHubOAuth,
  resolveBrowserShellBootstrapConfig,
  startGitHubOAuth,
  useAuthStore,
  useChatCooldown,
  useChatStore,
  type BrowserApp,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import '@tinytinkerer/app-browser/styles.css'
import { DOCS_LAB_STORAGE_NAMESPACE } from './constants'
import { deriveLabSessionSnapshot, LabSessionContext } from './lab-session-context'
import type { DocsLabRuntimeConfig } from './runtime-config'
import { useDocsLabRuntimeConfig } from './runtime-config'

type DocsLabApp = { app: BrowserApp; config: BrowserShellConfig }

// Module-level singleton (issue #451 acceptance: "multiple labs on one page share
// one isolated docs session"). Every <LiveLab> instance on the page calls
// `ensureDocsLabApp`, but the underlying BrowserApp — and therefore its auth,
// chat, and settings stores — is created at most once per page load.
let sharedAppPromise: Promise<DocsLabApp> | null = null

const buildDocsLabApp = async (runtimeConfig: DocsLabRuntimeConfig): Promise<DocsLabApp> => {
  // Read-only peek at the PRODUCT's own default-namespace token store (same
  // origin, same IndexedDB the main app already writes to). Never written back —
  // this is exactly what a "same-origin auth token, isolated everything-else"
  // reuse looks like: the token travels into the docs shell's config as a
  // `hostToken` (kept in memory only, see @tinytinkerer/app-browser's AuthTokenStore
  // contract), while conversations/preferences/model selection go into a
  // completely separate IndexedDB database below.
  const productShell = createBrowserShell({})
  const hostToken = await productShell.authTokens.getStoredToken()

  const config = resolveBrowserShellBootstrapConfig({
    baseUrl: '/',
    origin: window.location.origin,
    edgeBaseUrl: runtimeConfig.edgeBaseUrl,
    storageNamespace: DOCS_LAB_STORAGE_NAMESPACE,
    // 'host-token': this shell never runs its own GitHub OAuth (canStartGitHubOAuth
    // is false), it only ever borrows the token above. Sign-in happens through
    // beginDocsLabSignIn's separate, product-namespace shell instead.
    authMode: 'host-token',
    hostToken,
    sentryDsn: runtimeConfig.sentryDsn,
    sentryEnvironment: runtimeConfig.sentryEnvironment,
    appVersion: 'docs',
    buildHash: 'docs'
  })

  return { app: createBrowserApp(config), config }
}

export const ensureDocsLabApp = (runtimeConfig: DocsLabRuntimeConfig): Promise<DocsLabApp> => {
  sharedAppPromise ??= buildDocsLabApp(runtimeConfig).catch((error: unknown) => {
    sharedAppPromise = null
    throw error
  })
  return sharedAppPromise
}

// Sends a signed-out visitor to the product's OWN GitHub login (issue #451: "direct
// signed-out visitors to the existing app login flow"), not a docs-local OAuth flow.
// Deliberately uses a THROWAWAY shell with the PRODUCT's default storage namespace
// (no override), because startGitHubOAuth stores its state/return-url in
// sessionStorage keyed by that namespace, and the product's own callback route
// (owned by apps/host at the site root) completes the exchange under that same
// default namespace — a docs-namespaced shell here would leave the callback unable
// to find the state it validates against.
export const beginDocsLabSignIn = (runtimeConfig: DocsLabRuntimeConfig): boolean => {
  const config = resolveBrowserShellBootstrapConfig({
    baseUrl: runtimeConfig.productBaseUrl,
    origin: window.location.origin,
    edgeBaseUrl: runtimeConfig.edgeBaseUrl,
    authMode: 'oauth',
    ...(runtimeConfig.githubClientId ? { githubClientId: runtimeConfig.githubClientId } : {})
  })
  const shell = createBrowserShell(config)
  if (!canStartGitHubOAuth(shell)) {
    return false
  }
  startGitHubOAuth(shell)
  return true
}

// Clears ONLY the isolated docs-lab IndexedDB database (conversations, plugin
// settings, model selection) and reloads. Never touches the product's own
// database or token — those live under a different IndexedDB database name
// entirely (see buildDocsLabApp's read-only peek above).
export const resetDocsLabSession = async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DOCS_LAB_STORAGE_NAMESPACE)
    request.onsuccess = () => resolve()
    // A connection from this same page may still be open; the delete completes
    // once it closes (imminently, via the reload below), so this is not a failure.
    request.onblocked = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Failed to reset the lab session.'))
  })
  sharedAppPromise = null
  window.location.reload()
}

// Ensures the mountGlobals subtree (telemetry/privacy consent, human-prompt host,
// Konami listener) renders at most once per page even with several <LiveLab>
// instances mounted side by side — otherwise each would independently claim it via
// BrowserAppShell's default `mountGlobals: true` and the visitor would see duplicate
// consent dialogs. Deliberately mutated from an effect (not a useState initializer),
// so React StrictMode's dev-only double mount/cleanup settles on exactly one owner
// instead of a render-phase side effect double-firing it.
let globalsOwned = false

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
// BrowserAppShell for the SAME bootstrap/consent/error-boundary tree every other
// TinyTinkerer surface uses (issue #451: "retain existing privacy/telemetry
// consent behavior").
export default function ClientRuntime({ children }: ClientRuntimeProps) {
  const runtimeConfig = useDocsLabRuntimeConfig()
  const [ownsGlobals, setOwnsGlobals] = useState(false)
  const [appState, setAppState] = useState<AppState>({ phase: 'loading' })
  const [isResetting, setIsResetting] = useState(false)

  useEffect(() => {
    if (globalsOwned) {
      return undefined
    }
    globalsOwned = true
    setOwnsGlobals(true)
    return () => {
      globalsOwned = false
    }
  }, [])

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
    beginDocsLabSignIn(runtimeConfig)
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
      mountGlobals={ownsGlobals}
    >
      <SessionBridge isResetting={isResetting} signIn={signIn} reset={reset}>
        {children}
      </SessionBridge>
    </BrowserAppShell>
  )
}
