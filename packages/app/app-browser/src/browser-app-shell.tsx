import { StrictMode, Suspense, useState, type ComponentType, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppBrowserProvider } from './app'
import type { BrowserApp } from './app'
import { useBrowserAppBootstrap } from './bootstrap'
import { LazyHumanPromptHost } from './lazy-human-prompt-host'
import { LazyPrivacyPolicyUpdateGate } from './telemetry/lazy-privacy-update-gate'
import { LazyTelemetryConsentGate } from './telemetry/lazy-consent-gate'
import type { BrowserShellConfig } from './config'

export type BrowserAppShellProps = {
  app: BrowserApp
  config: BrowserShellConfig
  BootScreen: ComponentType<{ error?: string }>
  // Mount the document-level, single-instance hosts (HITL modal + telemetry/privacy
  // gates). A single-page shell mounts them; a composition rendering several App
  // panes in one document mounts exactly one shell with `mountGlobals` (the others
  // pass false) so the user never sees duplicate consent dialogs.
  mountGlobals?: boolean
  children: ReactNode
}

// The provider/gate tree shared by every browser shell and by the root composition.
// It runs the bootstrap for `app`, shows `BootScreen` until ready, then provides the
// app + React Query to `children`. Extracted from createBrowserShellRoot so the same
// tree can host either a RouterProvider (single-page shells) or several ChatApp panes
// (the root), all under one AppBrowserProvider = one continuous session.
export const BrowserAppShell = ({
  app,
  config,
  BootScreen,
  mountGlobals = true,
  children
}: BrowserAppShellProps) => {
  const [queryClient] = useState(() => new QueryClient())
  const { ready, error } = useBrowserAppBootstrap(app, config)

  if (!ready) {
    return <BootScreen {...(error ? { error } : {})} />
  }

  return (
    <StrictMode>
      <AppBrowserProvider app={app}>
        <QueryClientProvider client={queryClient}>
          {children}
          {mountGlobals ? (
            <>
              {/* The single human-in-the-loop modal (issue #85): renders nothing until a
                  plugin raises a prompt. Lazy so its CodeMirror dep code-splits out. */}
              <Suspense fallback={null}>
                <LazyHumanPromptHost />
              </Suspense>
              <Suspense fallback={null}>
                <LazyPrivacyPolicyUpdateGate />
              </Suspense>
              <Suspense fallback={null}>
                <LazyTelemetryConsentGate />
              </Suspense>
            </>
          ) : null}
        </QueryClientProvider>
      </AppBrowserProvider>
    </StrictMode>
  )
}
