/**
 * The floating documentation assistant (issue #480).
 *
 * The real `ChatApp` against the #479 assistant session — not a lightweight
 * parallel chat, and not an embedded live lab's conversation. It is registered as
 * an `inline` surface, so it renders inside the assistant provider at the
 * Root-mounted host and therefore survives every Docusaurus SPA navigation: the
 * conversation, the composer draft, and any in-flight tool call outlive a route
 * change because nothing about this subtree is remounted by one.
 *
 * `morphable={false}`: this is a global assistant, not the live labs' morphable
 * surface. Docking it into a sidebar is #472's shape, and the dock/undock toggle
 * here would offer a "web mode" that has no meaning on a documentation page.
 *
 * Lives in the runtime chunk (it imports `ChatApp`), which is why the launcher
 * that opens it does not — see AssistantLauncher.tsx.
 */
import { useCallback, useMemo, type ReactNode } from 'react'
import { ChatApp } from '@tinytinkerer/app-browser'
import { useDocsPageContext } from '../docs-page'
import { DOCS_ASSISTANT_LAYOUT_STORAGE_KEY } from './assistant-constants'
import {
  readDocsAssistantPresentation,
  setDocsAssistantMinimized,
  useDocsAssistantPresentation
} from './assistant-presentation'
import {
  DOCS_ASSISTANT_STARTER_PROMPT_COUNT,
  resolveDocsAssistantStarterPrompts
} from './assistant-starters'

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
  const { presentation } = useDocsAssistantPresentation()

  const starterPrompts = useMemo(() => resolveDocsAssistantStarterPrompts(active), [active])

  const handleMinimizedChange = useCallback((minimized: boolean) => {
    setDocsAssistantMinimized(minimized)
  }, [])

  // Read once, at mount, and deliberately not subscribed: this asks "did the
  // reader just click the launcher?", which is a fact about how this mount came
  // about. A returning reader's restored panel must not steal focus during page
  // load.
  const focusPanelOnMount = useMemo(() => readDocsAssistantPresentation().focusPanelOnMount, [])

  return (
    <ChatApp
      mode="floating"
      morphable={false}
      framed
      storageKey={DOCS_ASSISTANT_LAYOUT_STORAGE_KEY}
      LoadingComponent={AssistantChatLoading}
      // Controlled: the docs presentation store is the single authority on
      // open/minimized, and `FloatingLayout` owns geometry only. See
      // assistant-presentation.ts for why a mirrored flag would drift.
      minimized={presentation === 'minimized'}
      onMinimizedChange={handleMinimizedChange}
      focusPanelOnMount={focusPanelOnMount}
      starterPrompts={starterPrompts}
      starterPromptCount={DOCS_ASSISTANT_STARTER_PROMPT_COUNT}
      // The stage is click-through and the shell is not; the docs stylesheet
      // keys both off this class. Without it `.widget-stage`'s own
      // `min-height: 100vh` would add a viewport of page height to every route.
      stageClassName="docs-assistant-stage"
    />
  )
}
