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
 * single authority on mode and on open/minimized — `ChatApp` and `FloatingLayout`
 * would otherwise each persist half the answer, and the two disagree the moment
 * anything but the launcher opens the assistant.
 *
 * Morphing does not remount the session: only the layout wrapper swaps, so a run
 * in flight survives a dock or an undock exactly as it does on /widget.
 *
 * Lives in the runtime chunk (it imports `ChatApp`), which is why the launcher
 * that opens it does not — see AssistantLauncher.tsx.
 */
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { ChatApp, useDockedPanelMetrics, type ChatMode } from '@tinytinkerer/app-browser'
import { useDocsPageContext } from '../docs-page'
import { DOCS_ASSISTANT_LAYOUT_STORAGE_KEY } from './assistant-constants'
import {
  readDocsAssistantPresentation,
  setDocsAssistantMinimized,
  setDocsAssistantMode,
  useDocsAssistantPresentation
} from './assistant-presentation'
import {
  DOCS_ASSISTANT_STARTER_PROMPT_COUNT,
  resolveDocsAssistantStarterPrompts
} from './assistant-starters'
import { clearDocsAssistantPageInset, publishDocsAssistantPageInset } from './page-inset'

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

  const starterPrompts = useMemo(() => resolveDocsAssistantStarterPrompts(active), [active])

  const handleMinimizedChange = useCallback((minimized: boolean) => {
    setDocsAssistantMinimized(minimized)
  }, [])

  const handleModeChange = useCallback((mode: ChatMode) => {
    setDocsAssistantMode(mode)
  }, [])

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
    publishDocsAssistantPageInset(metrics)
  }, [metrics])
  useEffect(() => clearDocsAssistantPageInset, [])

  return (
    // A click-through mount, so the panel's geometry can be measured from one
    // stable element across a morph. It is what the root's pointer-events rule
    // excludes; the dialogs the shell mounts beside it stay interactive.
    <div className="docs-assistant-mount" ref={mountRef}>
      <ChatApp
        // Controlled on both axes: the docs presentation store is the single
        // authority, and the layouts own geometry only. See
        // assistant-presentation.ts for why a mirrored flag would drift.
        mode={presentation.mode}
        onModeChange={handleModeChange}
        minimized={presentation.minimized}
        onMinimizedChange={handleMinimizedChange}
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
