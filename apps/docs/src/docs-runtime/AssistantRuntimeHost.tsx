import { lazy, Suspense, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import BrowserOnly from '@docusaurus/BrowserOnly'
import { AssistantLauncher } from './AssistantLauncher'
import { LatchedErrorBoundary } from './LatchedErrorBoundary'
import {
  publishDocsAssistantRuntimeStatus,
  requestDocsAssistantRuntime,
  useDocsAssistantRuntimeActivation
} from './assistant-activation'
import {
  isDocsAssistantOpen,
  openDocsAssistant,
  useDocsAssistantPresentation
} from './assistant-presentation'
import { importAssistantRuntimeClient } from './assistant-runtime-loader'
import { useDocsHostOverlayOpen } from './host-overlays'

// The documentation assistant's runtime host (issues #479, #480), mounted from
// @theme/Root as a SIBLING of the Docusaurus page subtree.
//
// Sibling, not ancestor, and the reason is structural: BrowserAppShell renders
// its boot screen INSTEAD of its children and wraps them in StrictMode and an
// error boundary. As an ancestor it would blank the documentation while the
// assistant booted, double-render the whole site, and let an assistant error
// take a documentation page down with it. As a sibling it can fail entirely and
// the page is unaffected — which is also why this file adds an error boundary of
// its own around the lazy subtree.
//
// It is also the documentation's single assistant OVERLAY ROOT (#480): one fixed,
// click-through, `isolation: isolate` element that owns the whole z-index
// contract for everything the assistant draws — the launcher, the panel, and the
// consent and privacy dialogs the shell mounts inside it. One stacking context
// rather than per-element z-indexes, because those dialogs carry `z-[60]`/`z-[70]`
// of their own and would otherwise paint under Infima's 200-level navbar.
//
// This module stays LIGHT. It is imported by @theme/Root, which every
// documentation page loads, so a static import of @tinytinkerer/app-browser
// here would put the product runtime in every page's initial HTML — the thing
// scripts/check-docs-performance-budget.mjs exists to prevent. The runtime is
// reached through React.lazy behind <BrowserOnly> AND behind an explicit
// activation, so the chunk is fetched when a reader first asks for the
// assistant, not when they open a documentation page.

export const DocsAssistantRuntimeHost = (): ReactNode => {
  const { status, attempt } = useDocsAssistantRuntimeActivation()
  const presentation = useDocsAssistantPresentation()
  const hostOverlayOpen = useDocsHostOverlayOpen()
  const open = isDocsAssistantOpen(presentation)

  // A fresh payload per attempt. `React.lazy` memoises BOTH outcomes on the
  // payload object, so reusing one module-level `lazy(...)` would make every
  // retry rethrow the first rejection without ever calling `import()` again —
  // a status that advertises a retry it cannot perform. Keyed identically on the
  // subtree below, so the new payload actually gets mounted.
  // `attempt` is the whole dependency: nothing else the memo closes over can
  // change, and a new attempt must produce a new payload.
  const AssistantRuntimeClient = useMemo(() => lazy(importAssistantRuntimeClient), [attempt])

  // Pressing the launcher does BOTH: record that the panel is open, and ask for
  // the runtime. Not just the first — after a failed start the presentation is
  // already `open`, so a handler that only wrote the presentation would publish
  // nothing, fire no effect, and leave the reader pressing a "Try again" button
  // that does nothing. `requestDocsAssistantRuntime` is idempotent while
  // starting or ready, and retries from `idle` and `error`.
  const activate = useCallback(() => {
    openDocsAssistant()
    requestDocsAssistantRuntime()
  }, [])

  // A returning reader who left the panel open gets it back, runtime download
  // included (issue #480). "Retains the presentation state" cannot mean
  // "restores everything except the state the reader actually chose" — and the
  // cost falls only on readers who asked for it, since a new or minimized
  // visitor never reaches this branch and downloads no runtime at all.
  //
  // An effect, so static rendering never triggers it and the first client render
  // still agrees with the server.
  useEffect(() => {
    if (open) requestDocsAssistantRuntime()
  }, [open])

  const runtimeRequested = status === 'starting' || status === 'ready'

  return (
    // `inert` while a fullscreen lab, the mobile drawer, or the search dropdown
    // owns the viewport: it removes the whole subtree from the pointer, the tab
    // order, and the accessibility tree in one attribute, while leaving it
    // MOUNTED — the conversation, the composer draft, and any in-flight run
    // survive, and the persisted presentation is untouched. `data-host-overlay`
    // is what the stylesheet hides it on.
    // `tt-app-embed` marks the region app-browser's embed baseline applies to.
    // The RULES are the product's (packages/app/app-browser/src/embed.css); this
    // only says where they apply, which is the whole of what the assistant draws
    // — the panel and the dialogs the shell mounts beside it (issue #480
    // re-review, finding 1).
    // A named `complementary` landmark, not a bare div (issue #481). The
    // assistant is supporting content that sits beside the documentation for the
    // whole session, which is exactly what that role describes — and without it
    // axe reports every control the panel draws as "page content not contained by
    // landmarks", because this root is a sibling of the page's `<main>`. The
    // label is what a screen-reader landmark list shows, so it has to name the
    // thing rather than the element.
    <div
      className="docs-assistant-root tt-app-embed"
      role="complementary"
      aria-label="Documentation assistant"
      data-mode={presentation.mode}
      data-host-overlay={hostOverlayOpen ? 'true' : 'false'}
      {...(hostOverlayOpen ? { inert: true } : {})}
    >
      {/* The light launcher owns every state before the session is live, and
          nothing once it is: at `ready` the panel and ChatApp's own minimized
          launcher take over, so there is never a second interactive launcher. */}
      {status !== 'ready' ? <AssistantLauncher status={status} onActivate={activate} /> : null}

      {/* Nothing has asked for the assistant yet: no chunk, no session, no
          session storage touched. `error` also renders nothing — activating
          again moves it back to `starting` with a new attempt, which remounts
          the subtree below and re-runs the import. */}
      {/* Scoped to the assistant subtree, and to ONE attempt: `key`ed on the
          attempt number so a retry mounts a fresh boundary rather than one that
          has already latched. Docusaurus has its own error handling for the
          page; this exists so a broken assistant chunk never reaches it. */}
      {runtimeRequested ? (
        <LatchedErrorBoundary
          key={attempt}
          onError={(error, info) => {
            // Surfaced in the console, and as `error` in the activation store —
            // which is what the launcher reads to offer a retry.
            console.error(
              'The documentation assistant failed to start.',
              error,
              info.componentStack
            )
            publishDocsAssistantRuntimeStatus('error')
          }}
        >
          <BrowserOnly>
            {() => (
              <Suspense fallback={null}>
                <AssistantRuntimeClient />
              </Suspense>
            )}
          </BrowserOnly>
        </LatchedErrorBoundary>
      ) : null}
    </div>
  )
}
