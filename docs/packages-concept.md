# Packages Concept

This document explains how TinyTinkerer should divide responsibility between apps and packages in the future architecture. The main rule is simple: apps present the product, packages implement reusable capability.

## Why Apps Stay Thin

Thin apps make UI replacement practical.

- `apps/web` and `apps/widget` should be easy to change without rewriting product behavior.
- Shared product capability should not be trapped inside a single app shell.
- Embeddable surfaces are usually stricter than first-party app shells, so shared behavior must be designed for the stricter case.
- Thin apps also reduce drift. When behavior changes, it changes once in a shared layer instead of separately in each UI app.

## What Belongs In An App

Apps own shell-specific code.

- routes and top-level navigation
- screens and page-level composition
- shell layout and visual structure
- host embedding concerns
- app-specific configuration and bootstrapping
- final binding between UI components and shared controllers
- app-local UX decisions that are not shared feature behavior

Apps must not become the long-term home for shared orchestration, persistence logic, provider wiring, or non-trivial reusable feature runtimes.

## What Belongs In A Package

Packages own reusable capability.

- `contracts`: shared schemas and types
- `agent-core`: runtime abstractions and generic execution behavior
- `app-core`: headless product logic and orchestration
- `app-browser`: browser-specific adapters and integrations
- `ui`: presentational primitives
- `feature-*`: large shared features with real logic

If behavior is expected to survive a shell rewrite, it probably belongs in a package.

## Package Responsibilities

### `packages/contracts`

Owns:

- shared Zod schemas
- inferred TypeScript types
- agent event payloads
- planning payloads
- edge request and response payloads
- rate-limit payload contracts

Must not own:

- fetch clients
- React code
- runtime orchestration
- persistence logic

### `packages/agent-core`

Owns:

- `AgentRuntime`
- provider interfaces
- tool registry abstractions
- generic execution and rate-limit handling behavior

Must not own:

- GitHub-specific providers
- product-specific planning heuristics
- fetch clients for the edge app
- browser-only tools

### `packages/app-core`

Owns:

- headless chat/auth/settings orchestration
- feature policies and use-case logic
- event-to-view projections
- interfaces and ports for infrastructure concerns

Must not own:

- React hooks that require a renderer
- Zustand stores as the public reuse boundary
- browser APIs such as `window`, `sessionStorage`, or IndexedDB
- transport code

### `packages/app-browser`

Owns:

- Dexie or other browser persistence adapters
- session-based OAuth state helpers
- fetch-based edge clients
- concrete provider and tool wiring for browser apps
- shell configuration such as edge URL, storage namespace, and auth mode

Must not own:

- page layouts
- app-local screens
- feature presentation that is unique to one shell

### `packages/ui`

Owns:

- buttons
- form primitives
- shared visual building blocks
- lightweight styling helpers

Must not own:

- chat orchestration
- authentication flows
- search behavior
- Markdown or Mermaid feature runtimes
- product-specific controller logic

### `packages/feature-*`

Owns:

- large, reusable, non-trivial shared features
- feature-level rendering pipelines
- shared integration surfaces used by multiple apps or layers

Must not own:

- unrelated primitives
- app shell composition
- catch-all business logic

## Allowed And Forbidden Dependencies

Allowed examples:

- `apps/web` importing `app-core` controllers and `ui` primitives
- `apps/widget` importing `app-browser` storage and auth adapters
- `app-browser` importing `agent-core` and `contracts`
- `apps/edge` importing `contracts`

Forbidden examples:

- `apps/web` directly creating GitHub model providers or browser search tools instead of consuming shared adapters
- `app-core` importing Dexie, `fetch`, `sessionStorage`, or React
- `ui` containing app-specific feature flows or runtime composition
- `agent-core` owning product-specific integrations such as GitHub Models wiring
- `apps/widget` copying `apps/web` feature logic instead of reusing packages
- any app importing code from another app

## When To Introduce A New Package

Introduce a new package when all of the following are true:

- the feature is large enough to have its own behavior or integration pipeline
- the feature is expected to be reused by at least two apps or by multiple layers
- the feature would otherwise create duplicated logic or duplicated policy
- the feature has a clear ownership boundary

Do not create a package for trivial wrappers or one-off helpers. The point is to prevent meaningful duplication, not to atomize the repo.

## Case Study: Mermaid As A Shared Feature

Mermaid is the right example because it is more than a visual primitive.

If both `web` and `widget` support Mermaid rendering, these concerns should not be duplicated:

- markdown integration
- Mermaid source detection
- render pipeline setup
- sanitization and safety policy
- lazy-loading strategy
- shared styling glue
- fallback behavior when rendering fails

That shared behavior belongs in a dedicated package such as `@tinytinkerer/feature-mermaid`.

The apps should only own:

- where Mermaid content appears
- shell-specific layout and spacing
- app-local affordances around the rendered diagram

This is the model to reuse for any future large shared feature.

## Review Checklist For New Features

- [ ] Can this behavior live outside the app shell?
- [ ] Will more than one app or layer need this feature?
- [ ] Is the feature large enough to justify a dedicated package?
- [ ] Are contracts, headless logic, browser adapters, and UI presentation separated cleanly?
- [ ] Does `packages/ui` stay primitive-only?
- [ ] Does the proposal avoid app-to-app imports or copied feature runtimes?
