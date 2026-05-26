# Content Platform Boundary Review Findings

This review focuses on the current implementation in:

- `/tmp/workspace/NNTin/tinytinkerer/packages/content-core/src/index.ts`
- `/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`
- `/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`
- `/tmp/workspace/NNTin/tinytinkerer/packages/content-markdown/src/index.ts`
- `/tmp/workspace/NNTin/tinytinkerer/packages/content-mermaid/src/index.tsx`
- `/tmp/workspace/NNTin/tinytinkerer/packages/content-wireframe/src/index.tsx`

## Executive summary

The architecture is directionally good: `content-runtime` is genuinely platform-agnostic, `content-react` is the main React boundary, and browser shells consume a narrow `app-browser` facade. The main purity gaps are concentrated in five places:

1. markdown still leaks into the semantic AST
2. parser and renderer contracts still live in `content-core`
3. `content-markdown` is both a parser package and a React composition package
4. some semantic nodes still encode source-format or renderer concerns
5. node identity is only partially defined and React fills the gaps with renderer-local heuristics

## Findings

### 1. `MarkdownNode` leaks source-format concerns into the semantic AST

**Evidence**

- `content-core` exports `MarkdownNode` and includes it in `BlockNode` (`packages/content-core/src/index.ts:111-120`, `169-181`).
- `content-react` ships a default `'markdown'` plugin implemented with `react-markdown` (`packages/content-react/src/index.tsx:13-15`, `223-225`, `413-417`).
- `content-react` tests still build documents out of raw markdown nodes (`packages/content-react/tests/content-document-renderer.test.tsx:24-27`, `37-40`, `146-151`).

**Why this is a boundary violation**

`MarkdownNode` is not a semantic content concept; it is a source-format escape hatch. Keeping it in the core union means every consumer of the semantic AST must understand that “sometimes the semantic tree is still raw markdown”.

**Recommended refactor**

- Deprecate `MarkdownNode` in `content-core`.
- Replace it with one of:
  - a parser-local fallback that never escapes `content-markdown`, or
  - a clearly non-semantic `UnsupportedBlockNode` / `RawSourceBlockNode` that is explicitly transitional and not part of the long-term semantic model.
- Move the legacy raw-markdown renderer behind an adapter package or compatibility layer instead of keeping it in the default semantic renderer set.

### 2. `content-core` still owns parser- and renderer-shaped abstractions

**Evidence**

- `content-core` exports `ContentParser<TInput>` and `ContentRendererRegistry<TResult>` (`packages/content-core/src/index.ts:193-197`).
- The package documentation also describes parser and renderer contracts as core responsibilities (`docs/content-platform.md:46-60`).

**Why this is a boundary violation**

`content-core` should own semantic structure and identity semantics. Parser signatures and renderer registries are integration concerns that bias the core package toward current pipeline mechanics.

**Recommended refactor**

- Keep `content-core` limited to:
  - semantic node types
  - document/container types
  - identity/hash helpers
  - semantic traversal helpers if needed
- Move parser contracts into `content-markdown` or a future parser-focused package.
- Move renderer-registry shapes entirely into `content-runtime` / `content-react`.

### 3. `content-markdown` mixes markdown parsing with React runtime composition

**Evidence**

- `content-markdown` imports React (`createElement`, `useMemo`) and React runtime types (`packages/content-markdown/src/index.ts:19-20`, `21-42`).
- `MarkdownContent` parses markdown, builds a React runtime, registers React plugins, and renders a React component (`packages/content-markdown/src/index.ts:268-298`).
- `MarkdownContentProps.plugins` is typed as `readonly ReactContentPlugin[]`, so the markdown package exposes a React-specific extension surface (`packages/content-markdown/src/index.ts:268-273`).

**Why this is a boundary violation**

This makes `content-markdown` both:

- a parser package, and
- a React orchestration package

That blurs the semantic/parser boundary and lets React assumptions leak outside `content-react`.

**Recommended refactor**

- Split the package surface:
  - `content-markdown`: parser + markdown-to-semantic transforms only
  - `content-markdown-react` or `content-react` adapter: `MarkdownContent` component and runtime assembly
- Change composition APIs so parser output is `ContentDocument`, and renderer/runtime selection happens in React-facing code only.
- If a convenience component is still needed, keep it outside the parser package.

### 4. Some “semantic” nodes still encode renderer- or markdown-specific details

**Evidence**

- `MermaidNode` and `WireframeNode` are first-class core node types with raw fenced-block payloads (`code`, `meta`) (`packages/content-core/src/index.ts:130-149`).
- `CodeBlockNode` also preserves markdown fence metadata directly as `language` and `meta` (`packages/content-core/src/index.ts:122-128`).
- `content-markdown` promotes fenced code by markdown language string (`mermaid`, `wireframe`) directly into core node variants (`packages/content-markdown/src/index.ts:183-214`).
- `TableNode` flattens table cells to strings rather than semantic inline content (`packages/content-core/src/index.ts:151-159`, `packages/content-markdown/src/index.ts:102`, `216-229`).

**Why this is a boundary violation**

These types are still strongly shaped by markdown parsing and current renderer behavior. That reduces extensibility for future non-markdown sources and makes the semantic layer reflect current transport syntax instead of durable content meaning.

**Recommended refactor**

- Decide which of these are truly semantic product concepts:
  - If Mermaid and wireframe are real product-level content kinds, rename/document them as such and remove markdown-specific residue like raw `meta`.
  - If they are only fenced-code conventions, model them as richer `codeBlock` capabilities or as extension payloads owned by parser/renderer adapters.
- Consider richer semantic table cells (`InlineNode[]`) instead of flattening to strings if tables are expected to evolve.
- Avoid storing raw parser artifacts in core unless they are intentionally part of the semantic contract.

### 5. Node identity semantics are incomplete and partially renderer-local

**Evidence**

- Block node ids are optional across the core AST (`packages/content-core/src/index.ts:72-167`).
- Inline nodes have no ids at all (`packages/content-core/src/index.ts:19-70`).
- The parser assigns ids only for parsed block nodes (`packages/content-markdown/src/index.ts:47-61`, `104-180`, `216-229`).
- `content-react` invents fallback keys with `resolveNodeKey()` using ad hoc field selection plus render index (`packages/content-react/src/index.tsx:374-385`, `531-532`).
- `ListItemNodeView` and nested block rendering also fall back to index-derived keys (`packages/content-react/src/index.tsx:179-193`, `209-210`).

**Why this is a boundary violation**

Identity semantics should be defined once at the semantic layer, not re-inferred by each renderer. The current model is good enough for simple reparses, but it is not a complete contract for:

- hand-built documents
- future non-React renderers
- stateful node-local UI
- reordering or insertion of duplicate-content siblings

**Recommended refactor**

- Define an explicit node identity contract in `content-core`.
- Centralize key derivation in core/runtime rather than `content-react`.
- Prefer one of these models:
  - parsed nodes must always carry stable ids, and manual nodes should use a shared `assignNodeIds()` utility before rendering, or
  - all nodes carry required ids once they enter a runtime boundary
- If future plugins need inline-level state or fine-grained diffing, add identity semantics for inline nodes too.

## Prioritized refactor plan

### Near term

1. Move `ContentParser` and `ContentRendererRegistry` out of `content-core`.
2. Deprecate `MarkdownNode` and stop constructing it in tests and compatibility paths.
3. Move `MarkdownContent` out of `content-markdown` into a React-facing adapter package.
4. Replace `content-react`'s local `resolveNodeKey()` heuristic with a shared identity utility.

### Medium term

1. Clarify whether `mermaid` and `wireframe` are semantic node kinds or markdown-driven renderer plugins.
2. Remove raw parser residue (`meta`, markdown-specific fallback concepts) from core nodes unless explicitly justified.
3. Introduce a semantic normalization layer so markdown parsing is one producer of `ContentDocument`, not the shape-defining authority.

### Long term

1. Make renderer packages consume a stricter semantic contract with explicit identity guarantees.
2. Consider a plugin-driven semantic extension model so new content kinds do not require core AST growth for every renderer experiment.
3. Let markdown become only one ingest format among multiple possible content producers.

## Bottom line

The current platform has a solid package split, but the semantic center is still slightly contaminated by markdown-era escape hatches and React-era convenience APIs. The best next step is not a large rewrite; it is a focused separation pass that makes:

- `content-core` purely semantic
- `content-markdown` purely about parsing/normalization
- `content-react` purely about React rendering/composition
- node identity a shared semantic guarantee rather than a renderer fallback
