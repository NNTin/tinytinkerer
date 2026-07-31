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
  useDocsAssistantRuntime,
  useDocsAssistantRuntimeStatus
} from './assistant-activation'
export type { DocsAssistantRuntimeStatus } from './assistant-activation'
export { registerDocsAssistantSurface, setDocsAssistantSurfaceTarget } from './assistant-surface'
export type { DocsAssistantSurface } from './assistant-surface'
export { DOCS_ASSISTANT_STORAGE_NAMESPACE } from './assistant-constants'
// Types erase at build time, so re-exporting the session's shapes here costs a
// consumer nothing and lets a light module type a value it receives.
export type { DocsAssistantConversation, DocsAssistantSession } from './session'
