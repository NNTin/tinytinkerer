# Findings: `@tinytinkerer/content-runtime` architecture

## Overall assessment

The new content-runtime split is directionally good: the AST, coordinator, React renderer, markdown parser, and specialized plugins are now separated into clearer packages. The main architectural weakness is that the implementation still carries several hidden React-era assumptions, so the current design is more "React runtime plus plugin adapters" than a fully renderer-agnostic content platform.

## Status

- Addressed in the latest simplification slice: runtime plugin resolution now supports multiple candidates per node type, explicit `priority` + `matches(node)` semantics, execution policy, `prepareNode()` / `prepareDocument()`, and structured failure reasons.
- Addressed: Mermaid and Wireframe no longer require dedicated AST node types; they specialize `codeBlock` through runtime matching.
- Addressed: React now prepares lazy plugins through the runtime boundary instead of relying on plugin-local runtime bootstrapping during render.
- Deferred: streaming/incremental document delivery and any broader non-React renderer strategy beyond the current runtime contract.

## Targeted findings and corrections

### 1. Plugin isolation is incomplete because ownership is tracked only by `nodeType`

**Evidence**

- `createContentRuntime()` stores plugins in `Map<ContentNode['type'], AnyNodeRendererPlugin<TResult>>`, so registration is last-write-wins by node type with no ownership metadata or precedence rules (`/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- `MarkdownContent` and `ContentDocumentRenderer` both build runtimes by registering defaults first and overrides later, so override behavior depends on call order rather than an explicit policy (`/tmp/workspace/NNTin/tinytinkerer/packages/content-markdown/src/index.ts`, `/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).

**Why this is weak**

- A plugin cannot declare whether it is the canonical owner for a node type, an extension, or a temporary override.
- Two plugins for the same node type cannot coexist for different execution modes (preview-only, SSR-safe, client-only, etc.).
- The runtime cannot explain *why* a plugin won registration, which makes debugging and future extension harder.

**Targeted correction**

- Replace the single map value with a descriptor list per node type.
- Add explicit registration metadata such as `source`, `priority`, and `mode`.
- Resolve the active plugin through a runtime policy instead of raw registration order.

### 2. The registry API is not extensible enough for future runtime modes

**Evidence**

- The runtime API exposes `register`, `has`, and `getPlugin`, but no immutable snapshot, no unregister/replace flow, and no way to inspect all candidates for a node type (`/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- `content-react` still supports `renderers` and converts them back into plugins with `renderersToPlugins()`, dropping plugin identity, capabilities, load behavior, and fallback semantics (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).

**Why this is weak**

- The runtime cannot cleanly support host-driven composition rules.
- The legacy renderer-map path creates a second extension model with weaker semantics than real plugins.
- Future renderer packages will have to guess which registration path is authoritative.

**Targeted correction**

- Make plugins the only extension primitive at the runtime boundary.
- Deprecate `renderers` in favor of `plugins`.
- Expose a read-only registry snapshot so hosts can inspect resolved and unresolved capabilities before render.

### 3. Lazy loading exists at the contract level but is not coordinated by the lifecycle

**Evidence**

- `content-runtime` defines `load()` and `ensureLoaded()` and caches loads per node type (`/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- `content-react` never calls `ensureLoaded()` before render; the Mermaid plugin loads itself inside a React effect instead (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`, `/tmp/workspace/NNTin/tinytinkerer/packages/content-mermaid/src/index.tsx`).

**Why this is weak**

- The runtime owns lazy-loading on paper but not in practice.
- Hosts cannot preload a document before first paint, hydration, or stream handoff.
- Load failures happen inside plugin components rather than in a shared lifecycle phase.

**Targeted correction**

- Add explicit preload APIs such as `prepareNode()` / `prepareDocument()`.
- Let hosts choose whether to preload lazies, defer them, or reject them by policy.
- Keep plugin components focused on rendering loaded state instead of bootstrapping runtime state.

### 4. Fallback and error-boundary behavior is split across too many layers

**Evidence**

- `content-runtime` has host fallback and plugin fallback semantics (`/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- `content-react` wraps every rendered node in `<Suspense>` and `RendererBoundary` (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).
- Specialized plugins also embed their own local failure handling, for example Mermaid catches render failures and drops back to code view (`/tmp/workspace/NNTin/tinytinkerer/packages/content-mermaid/src/index.tsx`).

**Why this is weak**

- There is no single place that defines the difference between "unsupported", "load failed", "render failed", and "client-only".
- Error recovery is currently tuned to React component failures, not runtime lifecycle failures.
- Non-React renderers will need to re-invent the same state machine from scratch.

**Targeted correction**

- Promote failure modes to first-class runtime states.
- Make plugin fallback return reasons or statuses, not just rendered output.
- Move boundary policy to a renderer adapter layer so React, SSR, and non-React targets can translate the same runtime states differently.

### 5. Capability modeling is descriptive, not enforceable

**Evidence**

- `NodeRendererPluginCapabilities` currently contains only `lazy` and `preview` booleans (`/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- No runtime policy checks those capabilities before render or load.

**Why this is weak**

- The runtime cannot block client-only or networked plugins during SSR.
- `lazy: true` does not imply any preload or suspension policy.
- Capability flags do not help hosts answer "is this document safe to stream/server-render/offline-render?"

**Targeted correction**

- Split plugin metadata into `capabilities` and `requirements`.
- Add a host-supplied execution policy, for example: `{ allowLazy, allowDOM, allowNetwork, allowClientOnly }`.
- Make plugin resolution fail early when a plugin's requirements are incompatible with the active policy.

### 6. There is still hidden coupling between the generic runtime and the React renderer

**Evidence**

- `MarkdownContent` always creates a React runtime internally and renders through `ContentDocumentRenderer` (`/tmp/workspace/NNTin/tinytinkerer/packages/content-markdown/src/index.ts`).
- `content-platform.md` says `content-runtime` should keep React outside the coordinator, but the actual composition path goes through React-specific construction for every markdown render (`/tmp/workspace/NNTin/tinytinkerer/docs/content-platform.md`, `/tmp/workspace/NNTin/tinytinkerer/packages/content-markdown/src/index.ts`).
- `content-react` re-exports the core AST and becomes the required import surface for downstream content packages (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).

**Why this is weak**

- `content-markdown` is currently a React adapter, not just a parser package.
- Downstream packages depend on the React facade even when they conceptually only need AST/runtime contracts.
- A non-React renderer would need a parallel markdown adapter instead of reusing the current one.

**Targeted correction**

- Keep parsing in `content-markdown`, but move React composition into a thin React-only adapter.
- Let parser output stay renderer-neutral: `parseMarkdownContent(content) -> ContentDocument`.
- Provide separate host adapters such as `renderMarkdownWithReact(...)`, `renderMarkdownToHtml(...)`, or future stream-oriented adapters.

### 7. SSR and non-React support are blocked by plugin side effects

**Evidence**

- Mermaid uses module-level browser state and script injection through `document.head` (`/tmp/workspace/NNTin/tinytinkerer/packages/content-mermaid/src/index.tsx`).
- `PreviewCodeFrame` and copy interactions assume browser-only APIs such as `window` and `navigator.clipboard` (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).
- Wireframe rendering is iframe-based and implicitly browser-only (`/tmp/workspace/NNTin/tinytinkerer/packages/content-wireframe/src/index.tsx`).

**Why this is weak**

- SSR cannot reason about which plugins are safe to execute.
- Plugin state is shared at module scope rather than isolated per runtime or host environment.
- A server renderer has no official degraded path beyond "hope the React fallback happens to work".

**Targeted correction**

- Add explicit environment requirements such as `clientOnly`, `needsDOM`, and `sandboxed`.
- Prefer plugin factories for stateful plugins (`createMermaidPlugin()`) so state can be scoped per host/runtime.
- Require every browser-only plugin to provide a server-safe fallback contract.

### 8. Streaming support is currently cosmetic

**Evidence**

- `isStreaming` only affects CSS classes in `ContentDocumentRenderer` and `MarkdownContent` still reparses the full string on each content change (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`, `/tmp/workspace/NNTin/tinytinkerer/packages/content-markdown/src/index.ts`).

**Why this is weak**

- The runtime cannot distinguish stable nodes from incomplete nodes.
- Lazy-plugin preload and fallback decisions cannot be coordinated with partial document delivery.
- Future stream parsing will have to bypass the current runtime lifecycle rather than extend it.

**Targeted correction**

- Introduce an incremental document model or parse session abstraction.
- Let the runtime operate on document deltas, not only full documents.
- Ensure registry resolution and preload decisions can happen per node as chunks arrive.

## Recommended next steps

1. **First**: remove the dual `renderers`/`plugins` extension path and make plugin registration policy explicit.
2. **Second**: add runtime execution policy plus environment requirements so SSR/client/streaming decisions become enforceable.
3. **Third**: move React-specific lifecycle behavior into a renderer adapter and keep markdown parsing renderer-neutral.
4. **Fourth**: introduce document/node preparation APIs so lazy loading becomes part of the runtime lifecycle instead of ad hoc plugin behavior.

## Bottom line

The architecture is close to a strong package split, but the current implementation still treats React as the real runtime and `content-runtime` as a thin dispatch helper. Tightening registry semantics, lifecycle ownership, and execution policy would make the design hold up for streaming, SSR, and future non-React renderers.
