import {
  StrictMode,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode
} from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppBrowserProvider } from './app'
import type { BrowserApp } from './app'
import { AppErrorBoundary } from './app-error-boundary'
import { useBrowserAppBootstrap } from './bootstrap'
import { LazyKonamiCheatCode } from './konami/lazy-konami-cheat-code'
import { LazyHumanPromptHost } from './lazy-human-prompt-host'
import { armOAuthCallbackWatchdog } from './telemetry/oauth-callback-watchdog'
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

  // Arm the OAuth callback watchdog once boot is ready (issue #409 follow-up):
  // it is a backstop for a callback URL that no route/controller ever picks up
  // (the bug that motivated it — apps/host's root had no '/auth/callback' route
  // at all), so it must not fire while the app itself is still booting.
  useEffect(() => {
    if (!ready) {
      return undefined
    }
    return armOAuthCallbackWatchdog(() => app.stores.auth.getState().token)
  }, [ready, app])

  if (!ready) {
    return <BootScreen {...(error ? { error } : {})} />
  }

  return (
    <StrictMode>
      <AppErrorBoundary>
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
                {/* The Konami cheat code listener (issue #399): renders nothing until the
                    ten-key sequence completes. Lazy like its siblings so the recognizer
                    code-splits out of every shell's entry chunk (the canvas entry sits
                    within ~1 kB of its bundle-size guard); the chunk still loads right
                    after boot so the key listener is armed from the start. Document-level
                    and single-instance like its siblings above: every surface (apps/shell's
                    web/mobile/widget presentations, apps/canvas, and apps/host's root
                    composition) renders exactly one BrowserAppShell with mountGlobals —
                    apps/host/src/main.tsx passes it explicitly, and createBrowserShellRoot.tsx
                    (used by apps/shell and apps/canvas) omits the prop, which defaults to
                    true. */}
                <Suspense fallback={null}>
                  <LazyKonamiCheatCode />
                </Suspense>
              </>
            ) : null}
          </QueryClientProvider>
        </AppBrowserProvider>
      </AppErrorBoundary>
    </StrictMode>
  )
}
