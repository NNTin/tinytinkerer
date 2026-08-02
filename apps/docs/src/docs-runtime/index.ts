/**
 * Public surface of the documentation runtime (issue #479).
 *
 * Everything exported here is LIGHT: importing this module pulls no product
 * runtime, so `@theme/Root` — and any eagerly-loaded page component that wants
 * to register a surface or offer a launcher — can depend on it without putting
 * `@tinytinkerer/app-browser` into every documentation page's initial HTML.
 *
 * The assistant SESSION service (`useDocsAssistantSession`) deliberately lives
 * one module over, at `@site/src/docs-runtime/session`, because importing it
 * does pull the runtime. It is supported and public — #472 consumes it — but
 * only from a component registered through `registerDocsAssistantSurface`,
 * which by construction already renders inside the assistant provider and
 * therefore already lives in a lazily-loaded chunk.
 *
 * Nothing outside this directory should build a `BrowserApp`, name the
 * assistant's storage namespace, or reach for `ensureDocsAssistantApp`. There is
 * exactly one global assistant session, and this is how it is used.
 */
export { DocsAssistantRuntimeHost } from './AssistantRuntimeHost'
export {
  readDocsAssistantRuntimeStatus,
  requestDocsAssistantRuntime,
  useDocsAssistantRuntime
} from './assistant-activation'
export type { DocsAssistantRuntimeStatus } from './assistant-activation'
export { registerDocsAssistantSurface, setDocsAssistantSurfaceTarget } from './assistant-surface'
export type { DocsAssistantSurface, DocsAssistantSurfacePlacement } from './assistant-surface'
export { DOCS_ASSISTANT_STORAGE_NAMESPACE } from './assistant-constants'
export {
  isDocsAssistantOpen,
  openDocsAssistant,
  readDocsAssistantPresentation,
  setDocsAssistantMinimized,
  setDocsAssistantMode,
  useDocsAssistantPresentation
} from './assistant-presentation'
export type { DocsAssistantMode, DocsAssistantPresentationState } from './assistant-presentation'
// The stable wrapper the documentation page renders inside, so docking the
// assistant insets the page without remounting anything in it (issue #480
// re-review, finding 2).
export { DocsAssistantPageRegion } from './AssistantPageRegion'
// Issue #481's build-time rollback switch, read by `@theme/Root` before it
// mounts any of the above.
export { useDocsAssistantEnabled } from './runtime-config'
export {
  DOCS_ASSISTANT_DISCLOSURE,
  DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS,
  DOCS_ASSISTANT_DISCLOSURE_TITLE,
  DOCS_ASSISTANT_DISCLOSURE_VERSION
} from './assistant-disclosure'
// How a documentation-owned overlay tells the assistant to get out of the way
// (issue #480). `LabContainer` is the only caller today, for fullscreen labs.
export { setDocsHostOverlay } from './host-overlays'
// Types erase at build time, so re-exporting the session's shapes here costs a
// consumer nothing and lets a light module type a value it receives.
export type { DocsAssistantConversation, DocsAssistantSession } from './session'
