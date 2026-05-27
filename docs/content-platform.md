# Content Platform

This document defines the current shared assistant-content architecture for TinyTinkerer.

It complements [ARCHITECTURE.md](./ARCHITECTURE.md) and [packages-concept.md](./packages-concept.md) by describing the subsystem that owns assistant-content parsing, rendering, specialized runtimes, and fallback behavior.

## Purpose

The content platform exists to keep rich assistant output out of app shells while also preventing `@tinytinkerer/app-browser` and `@tinytinkerer/ui` from turning into content-specific dumping grounds.

The design goals are:

- keep frontend shells thin
- keep assistant-content parsing and rendering reusable across `web`, `widget`, and `mobile`
- keep `@tinytinkerer/ui` primitive-only
- keep heavy specialized renderers lazy and isolated from the main browser entry bundle
- keep the dispatch/orchestration layer platform-agnostic so React is one renderer among potential others

## Scope

This document describes the active content architecture in the repo today.

In scope:

- the semantic content AST (block + inline) with stable node IDs
- a platform-agnostic content runtime that owns plugin dispatch, lazy loading, and fallback policy
- markdown parsing into that AST
- a React runtime implementation that ships the default React plugins and chrome
- specialized content runtimes such as Mermaid and wireframe, registered as plugins
- shared fallback behavior for invalid or unsupported rich content

Out of scope:

- chat, auth, settings, or shell bootstrap logic
- browser OAuth or persistence helpers
- shell-specific page composition
- moving rich-content AST types into `@tinytinkerer/contracts`
- changing edge payloads away from assistant markdown strings

## Package Model

The content platform is split into six packages.

### `@tinytinkerer/content-core`

Owns the content AST, stable-ID utilities, and package-level contracts.

Owns:

- `BlockNode` / `InlineNode` / `ContentNode` / `ContentDocument`
- node-specific TypeScript types
- `computeNodeId` / `hashContent` (deterministic stable-ID helpers)
- `assignNodeIds()` for deterministic block, list-item, and inline-node identity normalization

Must not own:

- React code
- markdown parsing libraries
- browser runtime composition
- app-shell concerns

### `@tinytinkerer/content-runtime`

Owns the platform-agnostic content runtime coordinator and plugin contract.

Owns:

- `NodeRendererPlugin` interface (id, nodeType, priority, requirements, capabilities, matches, load, render, fallback)
- `ContentRuntime<TResult>` interface
- `createContentRuntime<TResult>` factory (register, getPlugins, resolve, renderNode, renderDocument, prepareNode, prepareDocument)
- host-supplied fallback + wrap hooks so platform-specific concerns (e.g. React Suspense + ErrorBoundary) stay outside the coordinator
- runtime execution policy and structured failure reasons

Must not own:

- React code
- markdown parsing
- DOM-specific concerns

### `@tinytinkerer/content-react`

Owns the React implementation of the content runtime, the default React plugins + chrome, and the outward-facing facade for the React side of the content platform.

Owns:

- `createReactContentRuntime` — builds a `ContentRuntime<ReactNode>` with default plugins pre-registered
- default React plugins (paragraph, heading, list, blockquote, thematic-break, code-block, table, image)
- React inline-node renderer (text, emphasis, strong, strikethrough, code, link, image, break)
- shared copy and preview/code interaction chrome (`PreviewCodeFrame`, `CodeBlockFallback`)
- React-side fallback policy (Suspense + RendererBoundary wrap)
- `ContentDocumentRenderer`
- re-exports of the content-core AST types and stable-ID helpers (`computeNodeId`, `hashContent`, `assignNodeIds`, `NodeId`, the full AST node-type set) and the React plugin/runtime types (`ReactContentRuntime`, `ReactContentPlugin`, `ReactNodeRendererPlugin`, `ContentNodeRendererProps`) so downstream content packages depend only on `content-react`
- re-exports of the runtime policy/failure types needed by downstream content packages

Must not own:

- markdown parsing
- app-shell state or routing
- browser runtime wiring that belongs in `app-browser`

### `@tinytinkerer/content-markdown`

Owns markdown parsing and AST transformation into the semantic `ContentDocument`. Imports AST types and the React runtime via `@tinytinkerer/content-react` only — never from `content-core` or `content-runtime` directly.

Owns:

- markdown parsing
- GFM support
- mapping markdown structures into block + inline `ContentNode`s
- stable ID assignment via `computeNodeId` plus final normalization through `assignNodeIds()` (re-exported by `content-react`)
- `MarkdownContent` — parses to `ContentDocument`, builds a `ReactContentRuntime` internally from an optional `plugins` array plus execution policy, and delegates rendering to `ContentDocumentRenderer`
- fallback rules for unsupported content

Must not own:

- shell-facing exports for apps
- direct imports from `content-core` or `content-runtime`

### `@tinytinkerer/content-mermaid`

Owns Mermaid-specific rendering behavior, exposed as a plugin. Imports node types, plugin contract, and shared chrome via `@tinytinkerer/content-react` only.

Owns:

- `mermaidPlugin` (`NodeRendererPlugin<'codeBlock'>` with `matches(node.language === 'mermaid')`, runtime `load()`, render, fallback)
- Mermaid runtime loading (script-injection lazy-import)
- Mermaid-specific fallback handling

Must not own:

- markdown parsing
- app-shell composition
- general browser runtime wiring
- direct imports from `content-core` or `content-runtime`

### `@tinytinkerer/content-wireframe`

Owns wireframe-specific rendering behavior, exposed as a plugin. Imports node types, plugin contract, and shared chrome via `@tinytinkerer/content-react` only.

Owns:

- `wireframePlugin` (`NodeRendererPlugin<'codeBlock'>` with `matches(node.language === 'wireframe')`, render, fallback)
- wireframe iframe sandboxing
- wireframe-specific fallback handling

Must not own:

- markdown parsing
- app-shell composition
- general browser runtime wiring
- direct imports from `content-core` or `content-runtime`

## AST Surface

The content platform owns the internal semantic AST. It is not a wire contract in this phase.

```ts
type BlockNode =
  | HeadingNode        // { type: 'heading', id?, level, children: InlineNode[] }
  | ParagraphNode      // { type: 'paragraph', id?, children: InlineNode[] }
  | ListNode           // { type: 'list', id?, ordered, start?, children: ListItemNode[] }
  | BlockquoteNode     // { type: 'blockquote', id?, children: BlockNode[] }
  | ThematicBreakNode  // { type: 'thematicBreak', id? }
  | CodeBlockNode      // { type: 'codeBlock', id?, code, language? }
  | ChoicePromptNode
  | TableNode
  | ImageNode

type InlineNode =
  | TextNode
  | EmphasisNode
  | StrongNode
  | StrikethroughNode
  | CodeInlineNode
  | LinkNode
  | ImageInlineNode
  | BreakNode

type ContentNode = BlockNode
type ContentDocument = { nodes: BlockNode[] }
```

Rules:

- `ContentNode` stays inside the content platform.
- `@tinytinkerer/contracts` does not mirror this AST yet.
- Every block, list-item, and inline node may carry an optional `id`. Markdown parsing assigns deterministic, prefix-stable block IDs via `computeNodeId`; hand-constructed documents may omit `id`, and the shared `assignNodeIds()` helper normalizes the full document before React rendering.
- `ChoicePromptNode` remains an extension point and does not require interactive behavior yet.
- Shared runtime layers may continue to treat assistant output as strings until a later transport change is intentionally planned.

## Shell-Facing API

The public browser-facing content surface is `AssistantContent` from `@tinytinkerer/app-browser`.

That means:

- browser shells render assistant output through `app-browser`, not through direct `content-*` imports
- the shell-facing component accepts raw assistant text plus shell-local styling hooks
- parsing, runtime construction, plugin registration, and fallback policy remain hidden behind `app-browser`
- shared content styling hooks may be exposed from the browser layer, but content packages do not own app-shell layout

## Composition Boundary

`@tinytinkerer/app-browser` is the browser-facing composition layer for the content platform.

Browser apps should not import `content-*` packages directly. Instead:

1. `app-browser` imports `MarkdownContent` from `content-markdown` and the `mermaidPlugin` / `wireframePlugin` exports from `content-mermaid` / `content-wireframe`. It does not import `content-react`, `content-runtime`, or `content-core`.
2. `app-browser` passes the plugins as a stable `plugins` array to `MarkdownContent`.
3. `MarkdownContent` parses the assistant text to a `ContentDocument`, internally builds a `ReactContentRuntime` via `createReactContentRuntime`, registers the supplied plugins on top of the default React plugins, and delegates document rendering to `ContentDocumentRenderer`.
4. Browser shells consume the final shell-safe export (`AssistantContent`) from `app-browser`.

This keeps the dependency surface small and preserves the rule that apps extend capability through `app-browser` instead of reaching into lower layers directly. Runtime construction is fully encapsulated by `content-markdown`, so adding or swapping plugins never leaks runtime types into `app-browser`.

## Browser Composition Diagram

```mermaid
flowchart LR
  appbrowser["@tinytinkerer/app-browser<br/>browser-facing content assembly"]

  subgraph ContentPlatform["Content Platform"]
    contentcore["@tinytinkerer/content-core<br/>AST + stable-ID helpers + contracts"]
    contentruntime["@tinytinkerer/content-runtime<br/>platform-agnostic coordinator"]
    contentreact["@tinytinkerer/content-react<br/>React runtime impl + chrome"]
    contentmarkdown["@tinytinkerer/content-markdown<br/>markdown parsing + React adapter"]
    contentmermaid["@tinytinkerer/content-mermaid<br/>MermaidPlugin"]
    contentwireframe["@tinytinkerer/content-wireframe<br/>WireframePlugin"]
  end

  ui["@tinytinkerer/ui<br/>presentational primitives"]

  appbrowser --> contentmarkdown
  appbrowser --> contentmermaid
  appbrowser --> contentwireframe

  contentreact --> contentruntime
  contentreact --> ui

  contentmarkdown --> contentreact
  contentmermaid --> contentreact
  contentwireframe --> contentreact

  classDef coreLayer fill:#ffe4e6,stroke:#be123c,color:#111827,stroke-width:2px;
  class contentcore coreLayer;
```

## Dependency Rules

- `content-core` must not depend on any workspace package.
- `content-runtime` may depend only on `content-core`.
- `content-react` may depend only on `content-core`, `content-runtime`, and `ui`. It is the public facade for the React side of the content platform and re-exports the content-core symbols downstream packages need.
- `content-markdown`, `content-mermaid`, and `content-wireframe` may depend only on `content-react`. They must not import `content-core` or `content-runtime` directly.
- `app-browser` may depend only on the outward-facing content packages (`content-markdown`, `content-mermaid`, `content-wireframe`). It must not depend on `content-react`, `content-runtime`, or `content-core` directly.
- The content platform must not depend on `app-browser`.
- Browser apps consume shell-facing content exports from `app-browser`, not directly from `content-*`.
- `ui` must not absorb content parsing, specialized renderers, or browser-shell runtime logic.
- `content-*` packages must not become a second browser runtime or a second app shell.

## Rendering Model

The current rendering split is:

- `content-markdown` parses raw markdown into the semantic `ContentDocument`, assigning stable block IDs and then normalizing any remaining block/list-item/inline ids through `assignNodeIds()`.
- `content-markdown` exposes a `MarkdownContent` adapter that accepts a `plugins` array plus optional runtime execution policy, builds a `ReactContentRuntime` via `createReactContentRuntime`, registers each supplied plugin, and delegates document rendering to `content-react`'s `ContentDocumentRenderer`. Runtime construction is memoized on the plugins-array reference.
- `content-react` provides `createReactContentRuntime`, which returns a `ContentRuntime<ReactNode>` with default React plugins pre-registered (paragraph, heading, list, blockquote, thematic break, code block, table, image). `ContentDocumentRenderer` first normalizes the document through `assignNodeIds()` and then wraps each rendered block in a runtime-backed preparation boundary plus `<Suspense>` + a class-based `RendererBoundary` so lazy plugins and thrown render errors degrade gracefully. `content-react` also re-exports the content-core AST types and stable-ID helpers so downstream content packages can drop direct `content-core` imports.
- `content-mermaid` and `content-wireframe` each export a typed `NodeRendererPlugin<'codeBlock'>` (`mermaidPlugin`, `wireframePlugin`) — registration on the runtime is a single `runtime.register(plugin)` call, performed inside `MarkdownContent`.
- `app-browser` only passes a stable `plugins` array (containing `mermaidPlugin` + `wireframePlugin`) to `MarkdownContent`. It does not see runtimes, default plugins, or AST types.

Specialized renderers such as Mermaid stay lazy-loadable: Mermaid's runtime is fetched via dynamic script injection on first use, so it does not bloat the main browser entry chunk.

## Parsing Rules

The content platform treats markdown as the source format for this phase and decomposes it into the semantic AST.

Initial mapping rules:

- fenced code blocks become `CodeBlockNode`
- `mermaid` and `wireframe` stay specialized through `CodeBlockNode.language`
- tables become `TableNode`
- standalone block images (a paragraph whose only child is an image) become `ImageNode`; inline images stay inside `ImageInlineNode` within a `ParagraphNode`
- headings become `HeadingNode`, prose paragraphs become `ParagraphNode`, lists become `ListNode` + `ListItemNode`, blockquotes become `BlockquoteNode`, `---` becomes `ThematicBreakNode`
- inline marks (emphasis, strong, strikethrough, code, link, hard break) map one-for-one to their `InlineNode` equivalents

Fallback rules:

- invalid or unsupported specialized blocks must not break rendering
- specialized rendering failures should degrade to readable content, typically a code-block-style fallback
- parsing should preserve display order so mixed markdown and specialized nodes render in the same sequence as the source text
- stable IDs guarantee that re-parsing identical content yields identical node identities, and appending content to a document does not change the IDs of prior nodes

## Adding a Renderer Package

The platform is plugin-driven: every block type maps to one or more `NodeRendererPlugin`s registered on a `ContentRuntime`. New rich-content kinds (executable widgets, embeds, citation cards, specialized images, custom choice prompts, etc.) ship as their own `@tinytinkerer/content-*` package, mirroring `content-mermaid` and `content-wireframe`.

### Two scenarios

Decide which case applies before adding a package:

1. **Specialized rendering for an existing AST node** — e.g., a richer `ImageNode` viewer or a custom `CodeBlockNode` specialization like Mermaid/wireframe. The block type already exists in `content-core` and usually has a default plugin in `content-react`. The new package only needs to ship a plugin that overrides the default through `priority` + `matches(node)`.
2. **A new AST node type** — e.g., a media embed, executable widget, or interactive `ChoicePromptNode`. The node variant has to be added to `content-core`, taught to the parser in `content-markdown`, and rendered by a new plugin package.

### Steps

1. **(Scenario 2 only) Add the node type.** Append the new variant to the relevant union in `content-core` (`BlockNode` or `InlineNode`) and re-export it from `content-react/src/index.tsx`. No package downstream of `content-react` should import the type from `content-core` directly.
2. **(Scenario 2 only, markdown-sourced nodes) Extend the parser.** Add a mapping rule in `content-markdown` that emits the new node. Use `computeNodeId(type, digest, occurrence)` (re-exported by `content-react`) to assign stable IDs, then let `assignNodeIds()` fill any remaining gaps.
3. **Create `packages/content-<name>/`** with:
   - `package.json` whose only workspace dep is `@tinytinkerer/content-react` (plus a `react` peer dep and any third-party runtime libs).
   - `tsconfig.json` extending the workspace base.
   - `src/index.tsx` exporting the plugin and (optionally) the renderer component.
4. **Define the plugin** as a `ReactNodeRendererPlugin<'<nodeType>'>`:
   - `id`: stable plugin identifier (e.g. `'choice-prompt'`).
   - `nodeType`: the AST `type` literal it handles.
   - `priority` + `matches(node)` when several plugins specialize the same node type.
   - `requirements`: declare whether the plugin is `lazy`, `clientOnly`, or `needsDom`.
   - `capabilities`: use `preview: true` for plugins that render a preview/code split.
   - `load()` (optional): lazy-import the heavy runtime. `content-runtime` calls this during `prepareNode()` / `prepareDocument()`; Mermaid does this with dynamic `<script>` injection so the runtime never lands in the main entry chunk.
   - `render(node, ctx)`: return a `ReactNode`. Use `ctx.renderBlock` to recurse into child blocks. Reuse `PreviewCodeFrame`, `CodeBlockFallback`, and other chrome from `content-react`.
   - `fallback(node, failure)`: return a safe fallback (typically `<CodeBlockFallback>`). The runtime's `wrap` already adds the preparation boundary, `<Suspense>`, and an error boundary on top.
5. **Tests.** Add `packages/content-<name>/tests/` covering the success, lazy-loading, and failure paths. Plugin-shape tests can render the renderer component directly; integration tests can pass the plugin via the `plugins` prop of `MarkdownContent`.
6. **Boundary rules.** Extend `scripts/check-boundaries.mjs`: the new package's allowed deps are itself and `@tinytinkerer/content-react`, and `app-browser` must be allowed to depend on the new package if it should be wired into the assistant surface.
7. **Compose.** Add the plugin to the stable `assistantPlugins` array in `packages/app-browser/src/assistant-content.tsx`, and add the workspace dep to `packages/app-browser/package.json`. Apps and shells do not need to change.
8. **Docs.** Update the package list and the dependency diagram in this document (and `docs/ARCHITECTURE.md` if the new package changes the platform's external surface).

### What stays the same

A new renderer package never:

- imports from `content-core` or `content-runtime` directly (use the `content-react` re-exports)
- builds its own `ContentRuntime` — `MarkdownContent` owns runtime construction
- depends on `app-browser` (that direction is forbidden)
- ships its own app-shell layout, routing, or transport

### Reusing the chrome

Most specialized renderers reuse the shared chrome from `content-react`:

- `PreviewCodeFrame` — the toggleable preview/code split with copy controls
- `CodeBlockFallback` — the canonical "show the source as code" fallback

Because the chrome and runtime mechanics live in `content-react`, a new plugin package usually stays small: it contributes the rendering logic and the `NodeRendererPlugin` shape, not new chrome.

## App Responsibilities

Apps still own:

- where assistant content appears
- shell-specific spacing and container styling
- app-local affordances around the rendered content

Apps do not own:

- markdown parsing
- content AST construction
- runtime instantiation or plugin registration
- Mermaid source detection
- wireframe runtime setup
- shared content fallback policy
