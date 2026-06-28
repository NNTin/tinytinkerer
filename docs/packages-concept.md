# Packages Concept

This document explains how TinyTinkerer should divide responsibility between apps and packages. The rule is simple: apps present shell-specific experiences, packages own reusable capability.

## Why Apps Stay Thin

Thin apps make UI replacement practical and reduce behavioral drift.

- `apps/web`, `apps/mobile`, and `apps/widget` should be easy to change without rewriting product behavior.
- Shared capability should not be trapped inside a single shell.
- The widget is the stricter surface, so shared behavior must be designed to survive compact or embedded shells.
- When behavior changes, it should usually change once in a package instead of separately in each app.

## What Belongs In An App

Apps own shell-specific code.

- routes and top-level navigation
- screens and page-level composition
- shell layout and visual structure
- host embedding concerns
- mobile install affordances
- widget window UX
- final binding between app-local markup and shared browser-facing APIs
- app-local copy and shell-specific affordances

Apps must not become the long-term home for shared orchestration, persistence logic, browser integration, or non-trivial reusable feature runtimes. Apps also must not reach past `app-browser` into lower runtime layers.

## Package Placement Rules

When shared code appears, place it according to what kind of thing it is:

- headless product logic -> `packages/app-core`
- browser-specific shared logic, shell-facing hooks, shared browser components, bootstrap helpers, and shared browser styles -> `packages/app-browser`
- product-agnostic iframe transport and hosting -> `packages/app-bridge` / `packages/app-harness`
- isolated third-party iframe runtime used by one harness -> `packages/app/<app>-app`
- app-specific bridge input/result contracts -> `packages/shared/<app>-protocol`
- stateless visual atoms and primitives -> `packages/ui`
- assistant-content parsing, AST, rendering, and specialized content runtimes -> `packages/content-*`
- foundational shared schemas and types -> `packages/contracts`
- product-agnostic runtime abstractions -> `packages/agent-core`
- favicon, icons, manifest, and theme metadata -> `packages/brand-assets`

Introduce a new package only when none of the existing boundaries is the right long-term home.

## Package Responsibilities

### `packages/contracts`

Owns:

- shared Zod schemas
- inferred TypeScript types
- canonical content-model schemas and types
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
- browser APIs such as `window`, `sessionStorage`, or IndexedDB
- fetch-based browser clients
- transport code

### `packages/app-browser`

Owns:

- browser persistence adapters
- session-based OAuth helpers
- fetch-based edge clients
- concrete provider and tool wiring for browser apps
- runtime application of shared brand metadata
- browser app creation and bootstrap config resolution
- browser-side composition of structured assistant content DTOs with the content platform
- shell-facing React hooks and controllers
- shared browser-facing components such as `AssistantContent` and the shared settings modal
- shared browser stylesheet and browser-facing visual behavior that is reused across shells

Must not own:

- page layouts
- app-local screens
- shell-specific copy
- feature presentation that is unique to one shell

### `packages/brand-assets`

Owns:

- favicon and icon definitions
- shared PWA manifest data
- shared theme metadata consumed by browser shells
- typed brand metadata objects validated against `contracts`

Must not own:

- DOM or `document.head` mutation
- app bootstrapping logic
- app-specific page titles or shell copy
- React code

### `packages/ui`

Owns:

- buttons
- form primitives
- icons and marks
- tiny visual atoms such as loading indicators
- lightweight styling helpers

Must not own:

- chat orchestration
- authentication flows
- search behavior
- markdown parsing
- Mermaid or wireframe runtimes
- product-specific controller logic
- persistence logic

### App harness packages

- `app-bridge` owns the product-agnostic, versioned transport, correlation, timeouts, handshake capability checks, and schema-bound verb execution.
- `app-harness` owns sandboxed iframe lifecycle, bridge handles, verb-to-tool adaptation, shared harness layout, and deployment-safe embedded app URL resolution.
- An `<app>-app` package owns one harness's third-party iframe runtime and is imported only by that harness's declared secondary entry.
- Each `<app>-protocol` package owns only that app's Zod input/result contracts, inferred types, identity, and advertised verb names.

The harness shell and iframe app declare architecture-role metadata in their manifests. This lets the boundary checker apply the generic layer rules to every future app without learning concrete package names.

### `packages/content-*`

The content platform is five packages with strict layering:

- `content-core` owns stable-ID helpers and source-plugin contracts over the canonical content model from `contracts`; it may depend on `contracts` only.
- `content-react` owns the React runtime implementation, default React plugins, inline renderer, shared chrome (`PreviewCodeFrame`, `CodeBlockFallback`), and render-time preparation/normalization adapter; depends on `content-core` and `ui`.
- `content-markdown` owns markdown parsing into the semantic AST and parser-only markdown sessions through `markdownSourcePlugin`; Mermaid and wireframe stay `codeBlock` specializations via `language`; depends directly on `content-core`.
- `content-mermaid` and `content-wireframe` each own one specialized `codeBlock` plugin plus their renderer, fallback, and execution requirements; each depends directly on `content-react` only and may expose both a factory export and a singleton convenience export.

Owns collectively:

- assistant-content behavior over the canonical shared content model
- source-plugin contracts + React renderer plugin contract
- markdown parsing
- generic content rendering
- specialized content plugins such as Mermaid and wireframe
- shared content fallback policy

Must not own:

- app shell composition
- browser OAuth or persistence logic
- unrelated primitives
- catch-all business logic

## Allowed And Forbidden Dependencies

Allowed examples:

- `apps/web` importing `app-browser` and `ui`
- `apps/mobile` importing `app-browser` and `ui`
- `apps/widget` importing `app-browser` and `ui`
- `app-browser` importing `app-core`, `contracts`, `brand-assets`, `content-react`, and outward-facing `content-*`
- `brand-assets` importing `contracts`
- `apps/edge` importing `contracts`

Forbidden examples:

- any browser app importing `contracts`, `app-core`, `agent-core`, `brand-assets`, or `content-*` directly
- any app importing code from another app
- `app-core` importing Dexie, `fetch`, `sessionStorage`, or React
- `ui` containing app-specific feature flows or runtime composition
- `content-*` bypassing `app-browser` to become a second browser assembly boundary
- `app-browser` absorbing page layouts or shell-specific page ownership
- `apps/widget` copying `apps/web` or `apps/mobile` feature logic instead of reusing packages

## Browser Assembly Boundary

For browser apps, `packages/app-browser` is the main shared frontend boundary.

- Browser apps should depend on `app-browser` instead of composing lower runtime layers themselves.
- If an app needs a lower-layer capability, `app-browser` should expose the browser-safe API for it.
- Shared brand links, manifests, and theme metadata should be applied through `app-browser`, not directly from app HTML or a lower-level package.
- Shared browser-shell behavior should usually be extracted into `app-browser` before it is copied into a second app.
- `app-browser` may expose React hooks and components when that is the correct shared browser-surface contract.
- Shared browser-shell build policy belongs in `scripts/browser-shell-vite.mjs`; app Vite configs supply only shell-specific plugins, PWA behavior, and development-server routes.

## When To Introduce A New Package

Introduce a new package only when all of the following are true:

- the shared behavior does not fit cleanly into `app-core`, `app-browser`, `ui`, `content-*`, `contracts`, `agent-core`, or `brand-assets`
- the feature is large enough to have its own behavior or integration pipeline
- the feature is expected to be reused by at least two apps or by multiple layers
- the feature would otherwise create duplicated logic or duplicated policy
- the feature has a clear ownership boundary

An isolated iframe runtime is the deliberate single-consumer exception: the package boundary
keeps third-party code, bridge handlers, and compliance ownership out of the deployable shell,
while the shell owns the route and build entry.

Do not create a package for trivial wrappers or one-off helpers. The point is to prevent meaningful duplication, not to atomize the repo.

## Case Study: Shared Frontend Behavior

The current frontend is the model to follow:

- shared chat, auth, settings, bootstrap, and browser integration behavior belongs in `@tinytinkerer/app-browser`
- shared assistant-content rendering belongs behind `@tinytinkerer/app-browser` and is implemented by `@tinytinkerer/content-*`
- stateless atoms such as icons and thinking indicators belong in `@tinytinkerer/ui`
- web, mobile, and widget keep their own page structure and shell-specific UX

This means similarity alone is not enough to justify extraction.

- extract shared behavior first
- extract generic visual atoms second
- keep page layout local unless the interaction contract is actually shared

## Review Checklist For New Frontend Work

- [ ] Is this shell-specific layout, or shared capability?
- [ ] If it is headless product behavior, should it live in `app-core`?
- [ ] If it is shared browser-shell behavior, should it live in `app-browser`?
- [ ] If it is only a stateless primitive, should it live in `ui`?
- [ ] If it is assistant-content parsing or rendering, should it live in `content-*`?
- [ ] Does the browser app dependency surface stay small, with `app-browser` as the shared assembly boundary?
- [ ] Does this avoid app-to-app imports and copied feature logic?
