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
 * does pull the runtime. It is supported and public — it is the interface #472
 * is intended to consume, and has no consumer yet — but it is importable only
 * from a component registered through `registerDocsAssistantSurface`,
 * which by construction already renders inside the assistant provider and
 * therefore already lives in a lazily-loaded chunk.
 *
 * Nothing outside this directory should build a `BrowserApp`, name the
 * assistant's storage namespace, or reach for `ensureDocsAssistantApp`. There is
 * exactly one global assistant session, and this is how it is used.
 *
 * ## What belongs here, and what was taken off it
 *
 * Two kinds of export, and nothing else (issue #482):
 *
 * 1. what a documentation module already imports — `@theme/Root` mounts the host
 *    and the page region and reads the rollback switch; `LabContainer` declares
 *    a fullscreen overlay;
 * 2. the surface/activation contract #472 will consume — registering a surface,
 *    pointing it at a portal target, and asking for the runtime.
 *
 * The storage namespace, the imperative status reader, and the per-axis
 * presentation mutators/readers were removed: none had a consumer, and none was
 * anything #472 was told to use. Publishing an API on the strength of a future
 * issue *maybe* wanting it is how a barrel becomes a compatibility surface
 * nobody chose — the same judgement that took the disclosure constants off this
 * list. A future consumer can be given a named export when it exists and can say
 * what it needs.
 */
export { DocsAssistantRuntimeHost } from './AssistantRuntimeHost'
export { useDocsAssistantRuntime } from './assistant-activation'
export type { DocsAssistantRuntimeStatus } from './assistant-activation'
export { registerDocsAssistantSurface, setDocsAssistantSurfaceTarget } from './assistant-surface'
export type { DocsAssistantSurface, DocsAssistantSurfacePlacement } from './assistant-surface'
// The stable wrapper the documentation page renders inside, so docking the
// assistant insets the page without remounting anything in it (issue #480
// re-review, finding 2).
export { DocsAssistantPageRegion } from './AssistantPageRegion'
// Issue #481's build-time rollback switch, read by `@theme/Root` before it
// mounts any of the above.
export { useDocsAssistantEnabled } from './runtime-config'
// How a documentation-owned overlay tells the assistant to get out of the way
// (issue #480). `LabContainer` is the only caller today, for fullscreen labs.
export { setDocsHostOverlay } from './host-overlays'
// Types erase at build time, so re-exporting the session's shapes here costs a
// consumer nothing and lets a light module type a value it receives.
export type { DocsAssistantConversation, DocsAssistantSession } from './session'
