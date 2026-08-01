// The ONE module in the assistant framework that imports the product runtime
// for real. It must only ever be reached through a dynamic import() (see
// assistant-runtime-loader.ts, reached from AssistantRuntimeHost.tsx's
// React.lazy, itself gated behind Docusaurus' <BrowserOnly> and an explicit
// activation), so a documentation page that never starts the assistant never
// downloads this chunk, and a static build never executes it.
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import {
  BrowserAppShell,
  type BrowserApp,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import '@tinytinkerer/app-browser/styles.css'
import './assistant-containment.css'
import { ensureDocsAssistantApp } from './assistant-app'
import { publishDocsAssistantRuntimeStatus } from './assistant-activation'
import { DOCS_ASSISTANT_WIDGET_SURFACE_ID } from './assistant-constants'
import { DocsAssistantSessionContext } from './assistant-session-context'
import { registerDocsAssistantSurface } from './assistant-surface'
import { AssistantSurfaces } from './assistant-surfaces'
import { DocsAssistantWidget } from './assistant-widget'
import { useDocsRuntimeConfig } from './runtime-config'

// Registered at module scope, which runs exactly once: this module is only ever
// reached through the loader's `import()`, and a module registry caches a
// resolved module even across the host's retry attempts.
//
// `inline` placement (issue #479's activation contract): the widget renders in the
// runtime host, inside the provider, and never consults a portal target. #472's
// Office is the `portal` case, and conflating the two is what made a portal
// surface silently remount inline when its target unmounted.
registerDocsAssistantSurface(DOCS_ASSISTANT_WIDGET_SURFACE_ID, DocsAssistantWidget, {
  placement: 'inline'
})

type AppState =
  | { phase: 'loading' }
  | { phase: 'ready'; app: BrowserApp; config: BrowserShellConfig }
  | { phase: 'error'; message: string }

// Marker string below is what scripts/check-docs-performance-budget.mjs greps
// the built chunks for; keep it unique to this module.
const ASSISTANT_BOOT_FAILURE = 'Failed to start the documentation assistant session.'

/**
 * Renders nothing, and publishes what the shell's bootstrap actually did.
 *
 * `BrowserAppShell` shows this INSTEAD of its children until `initializeBrowserApp`
 * resolves, and hands it the failure when it rejects. In a single-page shell that
 * is the whole window; here it is a non-visual host beside the documentation, and
 * #479 ships no user-facing surface at all — the launcher and its loading
 * affordance belong to #480. So boot progress goes to the activation store, where
 * a launcher can read it, and nothing is drawn on the page either way.
 *
 * Publishing the failure here is what keeps the status honest: auth, settings and
 * telemetry initialization all run inside that bootstrap, and a rejection there
 * used to leave the store saying `ready` with no provider mounted underneath it.
 */
const AssistantBootScreen = ({ error }: { error?: string }): null => {
  useEffect(() => {
    if (error !== undefined) publishDocsAssistantRuntimeStatus('error')
  }, [error])
  return null
}

type BoundaryProps = { children: ReactNode }
type BoundaryState = { failed: boolean }

/**
 * Catches a surface's render failure INSIDE the shell.
 *
 * React uses the nearest boundary, so this one runs before `BrowserAppShell`'s
 * own `AppErrorBoundary` — whose fallback is a full-app "Something went wrong /
 * Reload page" panel. That panel is right for a shell that owns its window and
 * quite wrong for an assistant embedded at the root of a documentation page, so
 * the failure becomes a status a launcher can act on instead.
 */
class AssistantSurfaceBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('A documentation assistant surface failed to render.', error, info.componentStack)
    publishDocsAssistantRuntimeStatus('error')
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * Mounted only as a child of `BrowserAppShell`, which renders its children only
 * after `initializeBrowserApp` has resolved. That is the whole trick behind an
 * honest `ready`: this component cannot exist before the session is live, so
 * publishing from its effect cannot lie about the lifecycle.
 *
 * It is also where the session is branded (see assistant-session-context.ts), so
 * one mount point answers both "is the assistant ready?" and "is this app the
 * assistant?".
 */
const AssistantSession = ({ app }: { app: BrowserApp }): ReactNode => {
  useEffect(() => {
    publishDocsAssistantRuntimeStatus('ready')
  }, [])

  return (
    <DocsAssistantSessionContext.Provider value={app}>
      <AssistantSurfaces />
    </DocsAssistantSessionContext.Provider>
  )
}

/**
 * The client-only assistant tree: resolve the singleton, then hand it to
 * `BrowserAppShell` for the same bootstrap/provider/error-boundary tree every
 * other TinyTinkerer surface uses.
 *
 * This shell owns the documentation site's document-global hosts — consent and
 * the privacy update gate, plus the Konami listener — for every `/docs/` route,
 * including the ones carrying live labs, which mount none of them.
 */
export default function AssistantRuntimeClient(): ReactNode {
  const runtimeConfig = useDocsRuntimeConfig()
  const [appState, setAppState] = useState<AppState>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    ensureDocsAssistantApp(runtimeConfig)
      .then(({ app, config }) => {
        if (cancelled) return
        // NOT `ready`: this only means the app was CONSTRUCTED. The shell below
        // still has to bootstrap it, and `AssistantSession` publishes when that
        // has actually happened.
        setAppState({ phase: 'ready', app, config })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setAppState({
          phase: 'error',
          message: error instanceof Error ? error.message : ASSISTANT_BOOT_FAILURE
        })
        publishDocsAssistantRuntimeStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [runtimeConfig])

  if (appState.phase !== 'ready') {
    // Construction failed (or is still in flight). Reported through the
    // activation status, which `activate()` can retry from; nothing is rendered
    // into the documentation either way.
    return null
  }

  return (
    <BrowserAppShell
      app={appState.app}
      config={appState.config}
      BootScreen={AssistantBootScreen}
      globalHosts={{
        // The documentation site's single consent/privacy owner. Live labs mount
        // these disabled, so a page with the assistant and three labs shows one
        // consent dialog, from this shell.
        telemetryConsent: true,
        privacyUpdate: true,
        konami: true,
        // NOT the human-in-the-loop host (issue #479 decision 4). Its queue is
        // module-global and carries no session identity, so with two apps in the
        // document a prompt would be drawn using the wrong app's plugin settings
        // and conversation titles. Nothing in the docs build can raise one —
        // plugin discovery is stubbed (see live-lab/plugin-registry-stub.ts) and
        // no documentation tool requests human input — so the honest answer is
        // to mount no host rather than a misroutable one. Session-scoped routing
        // is tracked in #489, and docs-runtime/__tests__/no-human-prompt.test.ts
        // fails loudly if a tool ever starts needing it.
        humanPrompt: false
      }}
    >
      {/* The boundary sits ABOVE the session, not inside it: a surface that
          throws on its first render must not commit `AssistantSession`, whose
          effect would otherwise publish `ready` AFTER the boundary had already
          published `error` — React runs `componentDidCatch` before the surviving
          effects flush. */}
      <AssistantSurfaceBoundary>
        <AssistantSession app={appState.app} />
      </AssistantSurfaceBoundary>
    </BrowserAppShell>
  )
}
