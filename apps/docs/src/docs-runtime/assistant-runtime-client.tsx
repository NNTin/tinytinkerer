// The ONE module in the assistant framework that imports the product runtime
// for real. It must only ever be reached through a dynamic import() (see
// AssistantRuntimeHost.tsx's React.lazy, itself gated behind Docusaurus'
// <BrowserOnly> and an explicit activation), so a documentation page that never
// starts the assistant never downloads this chunk, and a static build never
// executes it.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  BrowserAppShell,
  type BrowserApp,
  type BrowserShellConfig
} from '@tinytinkerer/app-browser'
import '@tinytinkerer/app-browser/styles.css'
import './assistant-containment.css'
import { ensureDocsAssistantApp } from './assistant-app'
import { publishDocsAssistantRuntimeStatus } from './assistant-activation'
import {
  readDocsAssistantSurfaces,
  readDocsAssistantSurfacesForServer,
  subscribeDocsAssistantSurfaces
} from './assistant-surface'
import { useDocsRuntimeConfig } from './runtime-config'

type AppState =
  | { phase: 'loading' }
  | { phase: 'ready'; app: BrowserApp; config: BrowserShellConfig }
  | { phase: 'error'; message: string }

// Renders nothing, deliberately.
//
// `BrowserAppShell` requires a boot screen and shows it INSTEAD of its children
// until the session is ready. In a single-page shell that is the whole window;
// here it is a non-visual host sitting beside the documentation, and #479 ships
// no user-facing surface at all — the launcher and its loading affordance
// belong to #480. Printing "Preparing…" at the root of every documentation page
// would be a visible regression, so boot progress is published to the
// activation module instead, where a launcher can read it.
//
// Marker string below is what scripts/check-docs-performance-budget.mjs greps
// the built chunks for; keep it unique to this module.
const ASSISTANT_BOOT_FAILURE = 'Failed to start the documentation assistant session.'

const AssistantBootScreen = (): null => null

const AssistantSurfaces = (): ReactNode => {
  const surfaces = useSyncExternalStore(
    subscribeDocsAssistantSurfaces,
    readDocsAssistantSurfaces,
    readDocsAssistantSurfacesForServer
  )

  return (
    <>
      {surfaces.map(({ id, Component, target }) =>
        target ? (
          // A portal keeps the component a logical descendant of this provider
          // — one app, one conversation repository, one query client — while the
          // page decides where it is physically drawn (issue #479 decision 2).
          createPortal(<Component />, target, id)
        ) : (
          <Component key={id} />
        )
      )}
    </>
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
        setAppState({ phase: 'ready', app, config })
        publishDocsAssistantRuntimeStatus('ready')
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
    // A failed bootstrap is reported through the activation status (retryable by
    // calling `activate()` again, which re-enters `ensureDocsAssistantApp` with
    // a cleared memo). Nothing is rendered into the documentation either way.
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
      <AssistantSurfaces />
    </BrowserAppShell>
  )
}
