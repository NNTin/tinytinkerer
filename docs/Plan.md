# Content Platform Migration Plan

This document is the implementation handoff for the content-platform migration.

The goal is to replace `@tinytinkerer/feature-markdown` with a dedicated content platform and align docs, package boundaries, browser composition, and app imports around that model.

## Plan Status

- [x] The target architecture has been researched against the current repo.
- [x] The migration decisions that affect package boundaries are locked in this document.
- [x] `docs/content-platform.md` exists and defines the target package model.
- [x] This handoff plan is decision-complete for implementation.
- [x] `docs/Plan.md` formatting has been validated with the workspace Prettier setup.
- [ ] Architecture docs are aligned with the content-platform model.
- [ ] Workspace packages and boundary rules are aligned with the content-platform model.
- [ ] Browser apps are migrated off `@tinytinkerer/feature-markdown`.

## Locked Decisions

- [x] Treat `ContentNode` as an internal content-platform AST in this phase.
- [x] Do not change edge DTOs or `@tinytinkerer/contracts` to emit structured content yet.
- [x] Keep `apps/host` in the documented architecture as a composition app, not a browser shell.
- [x] Do a direct cutover rather than leaving `feature-markdown` as a long-term compatibility layer.
- [x] Treat `ChoicePromptNode` as reserved only. Define the type, but do not add parsing or interactive rendering in v1.
- [x] Keep `Frontend Composition Layer` conceptual only; do not add a new `packages/common`.
- [x] Keep browser shells dependent on `@tinytinkerer/app-browser` and `@tinytinkerer/ui`, not directly on `content-*`.

## Target Deliverables

- [x] Add `docs/content-platform.md`.
- [x] Finalize `docs/Plan.md` as the implementation handoff.
- [ ] Update `docs/ARCHITECTURE.md` to replace `feature-*` content examples with the content-platform package set.
- [ ] Update `docs/packages-concept.md` to reflect the new package boundaries and dependency rules.
- [ ] Update `docs/ui-ux-concept.md` so it refers to the content platform instead of `feature-markdown` and `feature-mermaid`.
- [ ] Remove `packages/feature-markdown`.
- [ ] Add `packages/content-core`.
- [ ] Add `packages/content-react`.
- [ ] Add `packages/content-markdown`.
- [ ] Add `packages/content-mermaid`.
- [ ] Add `packages/content-wireframe`.
- [ ] Expose a shell-facing content renderer from `@tinytinkerer/app-browser`.
- [ ] Migrate `web`, `widget`, and `mobile` to the new `app-browser` content export.

## Implementation Order

- [ ] Phase 1: Update architecture and concept docs so the target graph is explicit before code moves.
- [ ] Phase 2: Update workspace boundary rules so new package work is protected by tooling.
- [ ] Phase 3: Add `content-core` and `content-markdown`.
- [ ] Phase 4: Add `content-react`.
- [ ] Phase 5: Add `content-mermaid` and `content-wireframe`.
- [ ] Phase 6: Integrate the composed content surface into `app-browser`.
- [ ] Phase 7: Migrate browser apps and tests.
- [ ] Phase 8: Remove `packages/feature-markdown` and validate the full workspace.

## Exact Package Responsibilities

### `packages/content-core`

- [ ] Export `ContentDocument`.
- [ ] Export `ContentNode`.
- [ ] Export `MarkdownNode`, `CodeBlockNode`, `MermaidNode`, `WireframeNode`, `ChoicePromptNode`, `TableNode`, and `ImageNode`.
- [ ] Export parser and renderer contract types used by the rest of the platform.
- [ ] Keep the package free of React, browser APIs, and markdown parser dependencies.

Expected shapes:

```ts
type ContentDocument = {
  nodes: ContentNode[]
}

type ContentNode =
  | MarkdownNode
  | CodeBlockNode
  | MermaidNode
  | WireframeNode
  | ChoicePromptNode
  | TableNode
  | ImageNode
```

### `packages/content-react`

- [ ] Implement the shared React rendering runtime for `ContentDocument`.
- [ ] Implement registry types for node renderers.
- [ ] Provide default renderers for markdown, code block, table, and image nodes.
- [ ] Support specialized renderer registration for Mermaid and wireframe nodes.
- [ ] Provide fallback rendering when a specialized renderer fails or is unavailable.

Expected responsibility split:

- `content-react` owns the document renderer and registry mechanism.
- `content-react` does not parse markdown.
- `content-react` may depend only on `content-core` and `ui`.

### `packages/content-markdown`

- [ ] Parse markdown into `ContentDocument`.
- [ ] Support the GFM behavior already expected by the current product surface.
- [ ] Map fenced code blocks with info `mermaid` to `MermaidNode`.
- [ ] Map fenced code blocks with info `wireframe` to `WireframeNode`.
- [ ] Map other fenced code blocks to `CodeBlockNode`.
- [ ] Map tables to `TableNode`.
- [ ] Map images to `ImageNode`.
- [ ] Preserve non-special markdown as `MarkdownNode`.
- [ ] Fall back safely instead of throwing when specialized parsing cannot be applied.

Expected parser behavior:

- Preserve display order across mixed markdown and specialized nodes.
- Treat markdown as the source format for this phase.
- Do not require any upstream runtime change in `app-core` or `contracts`.

### `packages/content-mermaid`

- [ ] Implement Mermaid node rendering.
- [ ] Keep Mermaid-specific runtime logic isolated here.
- [ ] Make the renderer compatible with lazy loading.
- [ ] Provide a code-block-style fallback when Mermaid rendering fails.

### `packages/content-wireframe`

- [ ] Implement wireframe node rendering.
- [ ] Keep wireframe-specific runtime logic isolated here.
- [ ] Make the renderer compatible with lazy loading.
- [ ] Provide a code-block-style fallback when wireframe rendering fails.

## Shell-Facing API Contract

`@tinytinkerer/app-browser` should expose the only app-facing rich-content surface.

- [ ] Add a shell-facing content export from `@tinytinkerer/app-browser`.
- [ ] Keep apps dependent on `app-browser` and `ui`, not directly on `content-*`.
- [ ] Parse assistant text through `content-markdown` inside `app-browser`.
- [ ] Compose the renderer registry inside `app-browser`.
- [ ] Register Mermaid and wireframe support through the content platform, not directly inside app shells.
- [ ] Preserve current shared CSS hooks such as `tt-markdown` and `tt-markdown--streaming`, or replace them with an intentional migration across all shells.
- [ ] Keep the app-facing API simple enough that browser shells only render a single content component or helper from `app-browser`.

Expected shell-facing API shape:

```ts
type AssistantContentProps = {
  content: string
  isStreaming?: boolean
  className?: string
}
```

The implementation may choose a different symbol name, but the API must stay narrow:

- raw assistant text in
- shell-safe React content out
- no direct shell knowledge of parser or renderer registration internals

## App Migration Checklist

- [ ] Replace `@tinytinkerer/feature-markdown` imports in `apps/web`.
- [ ] Replace `@tinytinkerer/feature-markdown` imports in `apps/widget`.
- [ ] Replace `@tinytinkerer/feature-markdown` imports in `apps/mobile`.
- [ ] Update tests and mocks that currently reference `@tinytinkerer/feature-markdown`.
- [ ] Remove package dependencies on `@tinytinkerer/feature-markdown` from the browser apps.

Migration constraints:

- Do not change `Turn.assistantText` transport in `app-core` during this phase.
- Do not introduce direct app imports from `content-core`, `content-react`, `content-markdown`, `content-mermaid`, or `content-wireframe`.

## Boundary Enforcement Checklist

- [ ] Update `scripts/check-boundaries.mjs` for the new package set.
- [ ] Restrict `web`, `widget`, and `mobile` to browser-shell dependencies rather than allowing direct `content-*` imports.
- [ ] Add explicit dependency rules for `content-core`.
- [ ] Add explicit dependency rules for `content-react`.
- [ ] Add explicit dependency rules for `content-markdown`.
- [ ] Add explicit dependency rules for `content-mermaid`.
- [ ] Add explicit dependency rules for `content-wireframe`.
- [ ] Remove the old `feature-*` assumptions from the boundary checker.

Required dependency rules:

- `content-core` depends on no workspace package.
- `content-react` may depend only on `content-core` and `ui`.
- `content-markdown` may depend only on `content-core`.
- `content-mermaid` and `content-wireframe` may depend only on `content-core` and `content-react`.
- `app-browser` may depend on the content platform.
- the content platform must not depend on `app-browser`, `app-core`, `agent-core`, or `apps/*`.

## Documentation Update Checklist

- [ ] Replace `feature-markdown` and `feature-mermaid` content-platform references in `docs/ARCHITECTURE.md`.
- [ ] Replace `feature-*` content-package language in `docs/packages-concept.md`.
- [ ] Update `docs/ui-ux-concept.md` so shared frontend rendering guidance refers to the content platform.
- [ ] Keep `apps/host` documented as composition infrastructure rather than a browser shell.
- [ ] Keep `docs/content-platform.md` aligned with the final code-level package boundaries if implementation details change during execution.

## Testing And Validation Checklist

- [ ] Add unit tests for AST node construction in `content-core` where useful.
- [ ] Add parser tests for markdown, fenced code, Mermaid fences, wireframe fences, tables, images, and mixed-content ordering.
- [ ] Add renderer tests for default node rendering in `content-react`.
- [ ] Add fallback tests for Mermaid and wireframe rendering failures.
- [ ] Add `app-browser` integration tests for parse-and-render composition.
- [ ] Update browser app tests affected by the new content export.
- [ ] Run `/home/nntin/.nvm/versions/node/v22.22.3/bin/pnpm check:boundaries`.
- [ ] Run `/home/nntin/.nvm/versions/node/v22.22.3/bin/pnpm lint`.
- [ ] Run `/home/nntin/.nvm/versions/node/v22.22.3/bin/pnpm typecheck`.
- [ ] Run `/home/nntin/.nvm/versions/node/v22.22.3/bin/pnpm test`.

## Bundle And Loading Checklist

- [ ] Preserve lazy loading for heavy content renderers such as Mermaid.
- [ ] Verify the main web entry chunk does not regress beyond the existing size guard.
- [ ] Keep specialized renderers out of eagerly loaded shell code.
- [ ] Confirm the browser shells still lazy-load their chat surfaces as expected.

Required performance behavior:

- Mermaid and wireframe runtime code must not be pulled into the eager entry bundle by default.
- Fallback rendering must remain available even when a specialized renderer fails to load.

## Acceptance Criteria

- [ ] `@tinytinkerer/feature-markdown` no longer exists.
- [ ] Rich-content package boundaries are documented and enforced.
- [ ] Browser shells render assistant content through `@tinytinkerer/app-browser`.
- [ ] Markdown, code blocks, tables, and images still render correctly.
- [ ] Mermaid and wireframe nodes have a defined rendering and fallback path.
- [ ] `apps/host` is still documented as composition infrastructure rather than as a browser shell.
- [ ] Docs consistently describe the content platform rather than `feature-*` content packages.

## Notes For The Implementing Agent

- [x] This plan intentionally does not require a wire-format migration.
- [x] This plan intentionally keeps the existing `app-core` text projection model in place.
- [x] This plan intentionally leaves `ChoicePromptNode` dormant for now.
- [x] This plan is ready to execute without additional architectural decisions.
