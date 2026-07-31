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
import { LazyPrivacyPolicyUpdateGate } from './telemetry/lazy-privacy-update-gate'
import { LazyTelemetryConsentGate } from './telemetry/lazy-consent-gate'
import type { BrowserShellConfig } from './config'
import { resolveGlobalHostCapabilities, type GlobalHostCapabilities } from './document-globals'

export type BrowserAppShellProps = {
  app: BrowserApp
  config: BrowserShellConfig
  BootScreen: ComponentType<{ error?: string }>
  // Which document-level, single-instance hosts this shell mounts (HITL modal,
  // telemetry/privacy gates, Konami listener). A single-page shell mounts all of
  // them — the default — while a composition rendering several App panes in one
  // document mounts exactly one shell with them enabled, so the user never sees
  // duplicate consent dialogs.
  //
  // Per-host rather than one boolean (issue #479): the docs assistant owns the
  // consent/privacy/Konami hosts for the whole documentation site yet must leave
  // `humanPrompt` off, because that queue is module-global and carries no
  // session identity. See ./document-globals.ts.
  globalHosts?: Partial<GlobalHostCapabilities>
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
  globalHosts,
  children
}: BrowserAppShellProps) => {
  const [queryClient] = useState(() => new QueryClient())
  const { ready, error } = useBrowserAppBootstrap(app, config)
  const hosts = resolveGlobalHostCapabilities(globalHosts)

  // Arm the OAuth callback watchdog once boot is ready (issue #409 follow-up):
  // it is a backstop for a callback URL that no route/controller ever picks up
  // (the bug that motivated it — apps/host's root had no '/auth/callback' route
  // at all), so it must not fire while the app itself is still booting.
  // Dynamically imported so the watchdog and its telemetry/URL helpers stay out
  // of every shell's startup entry chunk (the bundle-size guard keeps that entry
  // lean); a 10s boot-time backstop has no reason to load synchronously, and the
  // import resolves long before the window elapses. The eager callback path only
  // needs the flag setter, which lives in the tiny ./telemetry/oauth-callback-handled
  // module — so this stays the module's ONLY importer and Rollup can split it out.
  //
  // Owner-gated (issue #479): this arms a document-level timer that reports to
  // Sentry, and it sits OUTSIDE the host block below, so a second shell in the
  // same document would arm a second one and could report the same unhandled
  // callback twice — regardless of which hosts it was told to mount.
  const armsOAuthWatchdog = app.documentGlobals.oauthCallbackWatchdog
  useEffect(() => {
    if (!ready || !armsOAuthWatchdog) {
      return undefined
    }
    let disposed = false
    let cleanup: (() => void) | undefined
    void import('./telemetry/oauth-callback-watchdog').then(({ armOAuthCallbackWatchdog }) => {
      if (disposed) {
        return
      }
      cleanup = armOAuthCallbackWatchdog(() => app.stores.auth.getState().token)
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [ready, app, armsOAuthWatchdog])

  if (!ready) {
    return <BootScreen {...(error ? { error } : {})} />
  }

  return (
    <StrictMode>
      <AppErrorBoundary>
        <AppBrowserProvider app={app}>
          <QueryClientProvider client={queryClient}>
            {children}
            {/* The single human-in-the-loop modal (issue #85): renders nothing until a
                plugin raises a prompt. Lazy so its CodeMirror dep code-splits out. */}
            {hosts.humanPrompt ? (
              <Suspense fallback={null}>
                <LazyHumanPromptHost />
              </Suspense>
            ) : null}
            {hosts.privacyUpdate ? (
              <Suspense fallback={null}>
                <LazyPrivacyPolicyUpdateGate />
              </Suspense>
            ) : null}
            {hosts.telemetryConsent ? (
              <Suspense fallback={null}>
                <LazyTelemetryConsentGate />
              </Suspense>
            ) : null}
            {/* The Konami cheat code listener (issue #399): renders nothing until the
                ten-key sequence completes. Lazy like its siblings so the recognizer
                code-splits out of every shell's entry chunk (the canvas entry sits
                within ~1 kB of its bundle-size guard); the chunk still loads right
                after boot so the key listener is armed from the start. Document-level
                and single-instance like its siblings above: every surface (apps/shell's
                web/mobile/widget presentations, apps/canvas, and apps/host's root
                composition) renders exactly one BrowserAppShell that owns these hosts —
                apps/host/src/main.tsx and apps/docs' assistant runtime pass them
                explicitly, and createBrowserShellRoot.tsx (used by apps/shell and
                apps/canvas) omits the prop, which defaults to all-on. */}
            {hosts.konami ? (
              <Suspense fallback={null}>
                <LazyKonamiCheatCode />
              </Suspense>
            ) : null}
          </QueryClientProvider>
        </AppBrowserProvider>
      </AppErrorBoundary>
    </StrictMode>
  )
}
