# Migration Plan

This document describes the migration path from the current repo shape to the desired future architecture. Each iteration is intentionally incremental so the system can keep working while boundaries are tightened and responsibilities move into their long-term homes.

Nothing in this file is marked complete. It is a forward migration checklist.

## Iteration 1: Contracts Foundation

- [x] Create `packages/contracts` as the target replacement for `packages/types`
- [x] Move shared schemas and inferred types for agent events and edge DTOs into contracts
- [x] Remove duplicated response and request schemas from web, edge, and provider code where possible
- [x] Update imports so contracts become the shared source of truth
- [x] Define the removal plan for `packages/types`

## Iteration 2: Slim Agent Core

- [x] Keep only runtime abstractions in `packages/agent-core`
- [x] Move product-specific provider logic out of `agent-core`
- [x] Move product-specific tool implementations out of `agent-core`
- [x] Move planning heuristics out of `packages/shared`
- [x] Define the removal plan for `packages/shared`

## Iteration 3: Introduce App Core

- [x] Create `packages/app-core`
- [x] Move headless chat, auth, and settings orchestration into `app-core`
- [x] Move event-to-view projection helpers into `app-core`
- [x] Define ports for persistence, auth token access, status, search, and model gateways
- [x] Ensure `app-core` has no React or browser API dependency

## Iteration 4: Introduce Browser Adapters

- [x] Create `packages/app-browser`
- [x] Make `app-browser` the primary browser-facing composition package
- [x] Move Dexie persistence and browser storage concerns into `app-browser`
- [x] Move OAuth state handling into `app-browser`
- [x] Move fetch-based edge clients and GitHub Models provider and tool wiring into `app-browser`
- [x] Expose shell-facing browser APIs so apps do not import `app-core`, `agent-core`, or `contracts` directly
- [x] Add shell configuration for `edgeBaseUrl`, storage namespace, and auth mode

## Iteration 5: Refactor Web Into A Thin App

- [x] Refactor `apps/web` to consume `app-browser` as its primary shared runtime dependency
- [x] Keep routes, screens, and UI presentation inside the app
- [x] Remove app-local orchestration that now belongs in shared layers
- [x] Remove direct imports of `app-core`, `agent-core`, and `contracts` from the web app
- [x] Ensure the web app acts as a thin UI shell
- [x] Confirm no direct business-logic imports bypass the new layers

## Iteration 6: Modularize Edge

- [ ] Split `apps/edge` into route modules and supporting transport modules
- [ ] Keep edge stateless and contract-driven
- [ ] Ensure route validation comes from shared contracts where appropriate
- [ ] Remove monolithic route ownership from a single entry file
- [ ] Keep edge isolated from browser and UI concerns

## Iteration 7: Add Widget Shell

- [ ] Create `apps/widget` as an embeddable shell
- [ ] Reuse `app-browser` as the widget's primary shared runtime dependency instead of copying web logic
- [ ] Support host-token and OAuth-capable configurations through adapter config
- [ ] Keep widget-specific embedding and layout concerns local to the app
- [ ] Verify widget does not become a second copy of the web app internals

## Iteration 8: Shared Feature Packages

- [ ] Define the rule for dedicated shared feature packages
- [ ] Create feature packages only for large, reusable, non-trivial cross-app capabilities
- [ ] Use Mermaid as the first explicit example of this rule
- [ ] Treat direct app-to-feature imports as render-edge exceptions, not the default browser composition path
- [ ] Keep feature packages downward-only and prevent them from bypassing `app-browser`
- [ ] Keep `packages/ui` limited to primitives, not feature runtimes
- [ ] Add boundary enforcement in CI for forbidden imports, package cycles, and browser-app bypasses around `app-browser`
