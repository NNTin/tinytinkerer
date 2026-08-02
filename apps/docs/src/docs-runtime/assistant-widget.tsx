/**
 * The documentation assistant widget (issue #480).
 *
 * The real `ChatApp` against the #479 assistant session — not a lightweight
 * parallel chat, and not an embedded live lab's conversation. It is registered as
 * an `inline` surface, so it renders inside the assistant provider at the
 * Root-mounted host and therefore survives every Docusaurus SPA navigation: the
 * conversation, the composer draft, and any in-flight tool call outlive a route
 * change because nothing about this subtree is remounted by one.
 *
 * `morphable` (the default): the reader can dock it into the same web-mode
 * sidebar the IDE and canvas shells dock (issue #480 re-review, finding 2). Both
 * layouts are fully CONTROLLED from `assistant-presentation.ts`, which is the
 * single authority on mode, open/minimized, and dock edge.
 *
 * Morphing does not remount the session: only the layout wrapper swaps, so a run
 * in flight survives a dock or an undock exactly as it does on /widget.
 *
 * Lives in the runtime chunk (it imports `ChatApp`), which is why the launcher
 * that opens it does not — see AssistantLauncher.tsx.
 */
import { useEffect, useMemo, type ReactNode } from 'react'
import { ChatApp, useDockedPanelMetrics } from '@tinytinkerer/app-browser'
import { useDocsPageContext } from '../docs-page'
import { DOCS_ASSISTANT_LAYOUT_STORAGE_KEY } from './assistant-constants'
import {
  readDocsAssistantPresentation,
  setDocsAssistantPresentation,
  useDocsAssistantPresentation
} from './assistant-presentation'
import {
  DOCS_ASSISTANT_STARTER_PROMPT_COUNT,
  resolveDocsAssistantStarterPrompts
} from './assistant-starters'
import { clearDocsAssistantPageInset, publishDocsAssistantPageInset } from './page-inset'
import { useDocsHostOverlayOpen } from './host-overlays'

const AssistantChatLoading = ({ error }: { error?: string }): ReactNode => (
  <div className="docs-assistant-widget__loading" role="status">
    {error ? `The assistant could not start: ${error}` : 'Preparing the documentation assistant…'}
  </div>
)

export const DocsAssistantWidget = (): ReactNode => {
  // Read HERE rather than in the Root-mounted host: `Root` has no hooks, so its
  // element for the host keeps the same identity across navigation and React
  // bails out of re-rendering it. Only a component that consumes the page context
  // itself sees the route change — which is exactly what route-aware suggestions
  // need.
  const { active } = useDocsPageContext()
  const presentation = useDocsAssistantPresentation()
  const hostOverlayOpen = useDocsHostOverlayOpen()

  const starterPrompts = useMemo(() => resolveDocsAssistantStarterPrompts(active), [active])

  // Read once, at mount, and deliberately not subscribed: this asks "did the
  // reader just click the launcher?", which is a fact about how this mount came
  // about. A returning reader's restored panel must not steal focus during page
  // load.
  const focusPanelOnMount = useMemo(() => readDocsAssistantPresentation().focusPanelOnMount, [])

  // The same measurement `AppStageShell` insets `/ide` with, from the same hook.
  // The docs page is inset through CSS custom properties rather than a style prop,
  // because the element that has to move is a Root-level ancestor of every live
  // lab on the page — see page-inset.ts.
  const { ref: mountRef, metrics } = useDockedPanelMetrics()
  useEffect(() => {
    // Suppression is a presentation of the HOST, not a change to the reader's
    // stored assistant choice. Release the effective split while search, mobile
    // navigation, or a fullscreen lab owns the viewport, then restore it from
    // the still-mounted panel when that overlay closes.
    publishDocsAssistantPageInset(metrics, hostOverlayOpen)
  }, [hostOverlayOpen, metrics])
  useEffect(() => clearDocsAssistantPageInset, [])

  return (
    // A click-through mount, so the panel's geometry can be measured from one
    // stable element across a morph. It is what the root's pointer-events rule
    // excludes; the dialogs the shell mounts beside it stay interactive.
    <div className="docs-assistant-mount" ref={mountRef}>
      <ChatApp
        // One complete controlled value: mode, minimized, and snap edge can never
        // be split across a docs record and a hidden ChatApp record.
        presentation={presentation}
        onPresentationChange={setDocsAssistantPresentation}
        focusPanelOnMount={focusPanelOnMount}
        framed
        storageKey={DOCS_ASSISTANT_LAYOUT_STORAGE_KEY}
        LoadingComponent={AssistantChatLoading}
        starterPrompts={starterPrompts}
        starterPromptCount={DOCS_ASSISTANT_STARTER_PROMPT_COUNT}
        // Both stages are click-through overlays fixed to the viewport, and the
        // docs stylesheet keys both off this class. Without it `.widget-stage`'s own
        // `min-height: 100vh` would add a viewport of page height to every route,
        // and `.sidebar-stage`'s `h-screen` would do the same.
        stageClassName="docs-assistant-stage"
      />
    </div>
  )
}
