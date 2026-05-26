# Content Platform Boundary Review

## Verdict

The current package graph is fundamentally sound: `content-core` stays independent, `content-runtime` owns orchestration, `app-browser` consumes only the outward-facing content packages, and the workspace boundary checker reports no cycles (`/tmp/workspace/NNTin/tinytinkerer/scripts/check-boundaries.mjs`, `/tmp/workspace/NNTin/tinytinkerer/packages/*/package.json`).

The main architectural debt is not the package layering itself, but the places where the implementation still exposes compatibility seams or lets the boundary rules be enforced more weakly than the docs imply.

## Validation

### 1. `content-core` remains pure and runtime-agnostic — **pass**

- `@tinytinkerer/content-core` declares no workspace dependencies (`/tmp/workspace/NNTin/tinytinkerer/packages/content-core/package.json`).
- Its source exports only AST types, IDs, hashing, and parser/renderer contracts; there is no React, DOM, browser, or markdown-library import surface (`/tmp/workspace/NNTin/tinytinkerer/packages/content-core/src/index.ts`).

### 2. `content-runtime` owns orchestration instead of renderers — **pass**

- `createContentRuntime` is generic over `TResult` and owns registration, lookup, lazy-load coordination, fallback dispatch, and document rendering (`/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- It imports only `@tinytinkerer/content-core` (`/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/package.json`, `/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- No renderer implementation code lives in this package.

### 3. `content-react` is projection-only — **mostly pass, with one notable leak**

- The package correctly acts as the React facade: it re-exports `content-core` types and composes `content-runtime` into a `ReactNode` runtime (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).
- It appropriately owns React-only chrome such as `PreviewCodeFrame`, `CodeBlockFallback`, Suspense wrapping, and copy-to-clipboard behavior (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).
- However, `content-react` also carries a legacy `MarkdownNodeView` built on `react-markdown` + `remark-gfm`, and those libraries are declared directly in `content-react/package.json` (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`, `/tmp/workspace/NNTin/tinytinkerer/packages/content-react/package.json`).

That means the projection layer still owns a markdown compatibility renderer, which is the clearest place where the package is not purely “projection-only”.

### 4. Specialized packages behave as isolated plugins — **pass, with transitional API debt**

- `content-mermaid` exports `mermaidPlugin` and keeps Mermaid-specific loading/rendering local to the package (`/tmp/workspace/NNTin/tinytinkerer/packages/content-mermaid/src/index.tsx`).
- `content-wireframe` exports `wireframePlugin` and keeps iframe preview behavior local to the package (`/tmp/workspace/NNTin/tinytinkerer/packages/content-wireframe/src/index.tsx`).
- `app-browser` wires them in through a stable plugin array and does not reach into `content-react`, `content-runtime`, or `content-core` (`/tmp/workspace/NNTin/tinytinkerer/packages/app-browser/src/assistant-content.tsx`).

The debt is that both specialized packages still export legacy renderer maps (`mermaidRenderers`, `wireframeRenderers`) alongside the plugin API. Those exports preserve an alternate extension path that the architecture is otherwise trying to retire.

### 5. Circular dependency risk — **pass**

- The declared workspace dependencies are acyclic across the content stack (`/tmp/workspace/NNTin/tinytinkerer/packages/content-*/package.json`).
- The repository boundary checker completed successfully during validation and includes explicit cycle detection (`/tmp/workspace/NNTin/tinytinkerer/scripts/check-boundaries.mjs`).

### 6. Hidden browser or framework coupling — **mostly pass**

- `content-core` and `content-runtime` are free of browser/framework coupling (`/tmp/workspace/NNTin/tinytinkerer/packages/content-core/src/index.ts`, `/tmp/workspace/NNTin/tinytinkerer/packages/content-runtime/src/index.ts`).
- `content-react` contains explicit React and browser APIs, which is acceptable for the React projection layer (`/tmp/workspace/NNTin/tinytinkerer/packages/content-react/src/index.tsx`).
- `content-mermaid` contains explicit `window`/`document` usage for runtime loading, which is acceptable for a browser-only specialized plugin (`/tmp/workspace/NNTin/tinytinkerer/packages/content-mermaid/src/index.tsx`).

The only coupling that feels hidden rather than intentional is the legacy markdown rendering path inside `content-react`, because markdown compatibility logic pulls parser/renderer libraries into the layer that is otherwise supposed to stay renderer-focused.

### 7. Package responsibilities are cohesive and scalable — **mostly pass**

- The package split is cohesive today: AST/contracts in core, runtime mechanics in runtime, React projection in react, markdown parsing in markdown, specialized rendering in isolated plugins, shell composition in `app-browser`.
- The main scalability concern is policy enforcement: the checker only scans each package’s `src/` tree (`collectSourceFiles` starts from `src`), so test imports and declared-but-unused package dependencies are outside the automated guardrails (`/tmp/workspace/NNTin/tinytinkerer/scripts/check-boundaries.mjs`).

## Recommended structural changes

1. **Move the legacy `MarkdownNode` renderer out of `content-react`.**  
   Either place it in `content-markdown` or in a small compatibility plugin package. That would let `content-react` stay focused on projecting semantic nodes instead of owning markdown-library behavior.

2. **Retire the legacy renderer-map exports from specialized packages.**  
   Deprecate and eventually remove `mermaidRenderers` and `wireframeRenderers` so plugins remain the single extension mechanism.

3. **Strengthen boundary enforcement.**  
   Extend `scripts/check-boundaries.mjs` to validate:
   - declared workspace dependencies in `package.json`, not only source imports
   - test files, or explicitly codify that tests are exempt
   - browser/framework bans for `content-core` and `content-runtime`, similar to the existing checks for `app-core` and `agent-core`

4. **Document the remaining compatibility exception explicitly.**  
   If `MarkdownNode` must stay for now, mark it as a temporary compatibility escape hatch in the architecture docs so future contributors do not treat markdown-in-`content-react` as the intended steady state.
