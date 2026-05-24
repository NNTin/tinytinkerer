# Content Platform Migration Plan

This plan is written for handoff to an implementation agent.

The goal is to replace `@tinytinkerer/feature-markdown` with a dedicated content platform and align docs, package boundaries, and browser composition around that model.

## Constraints

- [ ] Treat `ContentNode` as an internal content-platform AST in this phase.
- [ ] Do not change edge DTOs or `@tinytinkerer/contracts` to emit structured content yet.
- [ ] Keep `apps/host` in the documented architecture as a composition app, not a browser shell.
- [ ] Do a direct cutover rather than leaving `feature-markdown` as a long-term compatibility layer.
- [ ] Treat `ChoicePromptNode` as reserved only. Define the type, but do not add parsing or interactive rendering in v1.

## Deliverables

- [ ] Add `docs/content-platform.md`.
- [ ] Update `docs/ARCHITECTURE.md` to replace `feature-*` content examples with the content-platform package set.
- [ ] Update `docs/packages-concept.md` to reflect the new package boundaries and dependency rules.
- [ ] Update `docs/ui-ux-concept.md` so it refers to the content platform instead of `feature-markdown` and `feature-mermaid`.
- [ ] Remove `packages/feature-markdown`.
- [ ] Add these packages:
  - [ ] `packages/content-core`
  - [ ] `packages/content-react`
  - [ ] `packages/content-markdown`
  - [ ] `packages/content-mermaid`
  - [ ] `packages/content-wireframe`
- [ ] Expose a shell-facing content renderer from `@tinytinkerer/app-browser`.
- [ ] Migrate `web`, `widget`, and `mobile` to the new `app-browser` content export.

## Package Responsibilities

### `packages/content-core`

- [ ] Define `ContentDocument`.
- [ ] Define `ContentNode` and the node-specific TypeScript types.
- [ ] Include `MarkdownNode`, `CodeBlockNode`, `MermaidNode`, `WireframeNode`, `ChoicePromptNode`, `TableNode`, and `ImageNode`.
- [ ] Define parser and renderer contract types needed by the rest of the platform.
- [ ] Keep the package free of React, browser APIs, and markdown parser dependencies.

### `packages/content-react`

- [ ] Implement the shared React rendering runtime for `ContentDocument`.
- [ ] Implement registry types for node renderers.
- [ ] Provide default renderers for markdown, code block, table, and image nodes.
- [ ] Support specialized renderer registration for Mermaid and wireframe nodes.
- [ ] Provide clear fallback rendering when a specialized renderer fails or is unavailable.

### `packages/content-markdown`

- [ ] Parse markdown into `ContentDocument`.
- [ ] Support GFM behavior needed by the current product surface.
- [ ] Map fenced code blocks with info `mermaid` to `MermaidNode`.
- [ ] Map fenced code blocks with info `wireframe` to `WireframeNode`.
- [ ] Map other fenced code blocks to `CodeBlockNode`.
- [ ] Map tables to `TableNode`.
- [ ] Map images to `ImageNode`.
- [ ] Preserve non-special markdown as `MarkdownNode`.
- [ ] Fall back safely instead of throwing when specialized parsing cannot be applied.

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

## `app-browser` Integration

- [ ] Add a shell-facing content export from `@tinytinkerer/app-browser`.
- [ ] Parse assistant text through `content-markdown` inside `app-browser`.
- [ ] Compose the renderer registry inside `app-browser`.
- [ ] Register Mermaid and wireframe support through the content platform, not directly inside app shells.
- [ ] Preserve current shared CSS hooks such as `tt-markdown` and `tt-markdown--streaming`, or replace them with an intentional migration across all shells.
- [ ] Keep the app-facing API simple enough that browser shells only render a single content component or helper from `app-browser`.

## App Migration

- [ ] Replace `@tinytinkerer/feature-markdown` imports in `apps/web`.
- [ ] Replace `@tinytinkerer/feature-markdown` imports in `apps/widget`.
- [ ] Replace `@tinytinkerer/feature-markdown` imports in `apps/mobile`.
- [ ] Update tests and mocks that currently reference `@tinytinkerer/feature-markdown`.
- [ ] Remove package dependencies on `@tinytinkerer/feature-markdown` from the browser apps.

## Boundary Enforcement

- [ ] Update `scripts/check-boundaries.mjs` for the new package set.
- [ ] Restrict `web`, `widget`, and `mobile` to browser-shell dependencies rather than allowing direct `content-*` imports.
- [ ] Add explicit dependency rules for `content-core`.
- [ ] Add explicit dependency rules for `content-react`.
- [ ] Add explicit dependency rules for `content-markdown`.
- [ ] Add explicit dependency rules for `content-mermaid`.
- [ ] Add explicit dependency rules for `content-wireframe`.
- [ ] Remove the old `feature-*` assumptions from the boundary checker.

## Testing

- [ ] Add unit tests for AST node construction in `content-core` where useful.
- [ ] Add parser tests for markdown, fenced code, Mermaid fences, wireframe fences, tables, images, and mixed-content ordering.
- [ ] Add renderer tests for default node rendering in `content-react`.
- [ ] Add fallback tests for Mermaid and wireframe rendering failures.
- [ ] Add `app-browser` integration tests for parse-and-render composition.
- [ ] Update browser app tests affected by the new content export.
- [ ] Run `pnpm check:boundaries`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.

## Bundle and Loading Checks

- [ ] Preserve lazy loading for heavy content renderers such as Mermaid.
- [ ] Verify the main web entry chunk does not regress beyond the existing size guard.
- [ ] Keep specialized renderers out of eagerly loaded shell code.
- [ ] Confirm the browser shells still lazy-load their chat surfaces as expected.

## Acceptance Criteria

- [ ] `@tinytinkerer/feature-markdown` no longer exists.
- [ ] Rich-content package boundaries are documented and enforced.
- [ ] Browser shells render assistant content through `@tinytinkerer/app-browser`.
- [ ] Markdown, code blocks, tables, and images still render correctly.
- [ ] Mermaid and wireframe nodes have a defined rendering and fallback path.
- [ ] Docs consistently describe the content platform rather than `feature-*` content packages.
