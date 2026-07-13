# tin-105 — App-shell consistency and shared-code consolidation

**Status:** Implemented through stages 1–6 on the TIN-106 follow-up branch.
**Base:** `tin-105/stage-1-dockable-title`.

## Decision

Canvas, IDE, and Mermaid use the same trusted, integrated application-shell model. Excalidraw no
longer runs behind an application iframe or a `postMessage` transport. Package boundaries, lazy
chunks, schema validation, and app-owned IndexedDB persistence provide the code-ownership,
performance, validation, and data-lifecycle boundaries that the product needs.

Purpose-built isolation remains mandatory for untrusted executable content, including Sandpack
execution and the code-execution plugin. It is not used merely to separate trusted first-party UI.

## Goals

1. One integrated shell model for all three workspaces.
2. App-agnostic shared infrastructure with strict dependency direction.
3. No duplicate controller, tool-adapter, workspace-store, router, callback, or loading boilerplate.
4. Canvas data migrated safely from localStorage to a shared IndexedDB abstraction.
5. Excalidraw kept out of the startup graph through a package-local lazy boundary.
6. One deployed/E2E origin, matching production topology.

## Implemented stages

### Stage 1 — app-agnostic dock title

`DockablePanelLayout` accepts a consumer-supplied workspace title rather than embedding Mermaid
copy. This is the base commit for the follow-up work.

### Stage 2 — package rename

The mixed-purpose `@tinytinkerer/app-harness` name became `@tinytinkerer/app-shell`. Consumers and
workspace metadata were updated before behavior changed.

### Stage 3 — shared integrated-stage seams

`app-shell` now owns:

- `createStageControllerHandle`
- `createStageTools`
- `createWorkspaceStore`
- `useRequestAssistantAction`

IDE and Mermaid use these seams instead of local copies.

### Stage 4 — two/three-panel workspace

`DockablePanelLayout` accepts exactly two or three panels, with presets, accessible pointer and
keyboard resizing, panel swapping, persisted custom layouts, reset, and a narrow stacked mode.
IDE and Mermaid use the shared layout contract.

### Stage 5 — integrated Canvas

The former Canvas protocol and Excalidraw runtime packages were consolidated into
`@tinytinkerer/canvas`. Canvas now supplies:

- directly mounted Excalidraw and Assistant dock panels;
- schema-validated in-process controller methods and model tools;
- a stable lightweight controller handle;
- a package-local lazy stage boundary so Excalidraw stays outside startup chunks;
- direct library import relay through the Excalidraw API;
- `tinytinkerer-canvas` IndexedDB persistence;
- fail-safe migration of `tinytinkerer:canvas-scene:v1` from localStorage.

The callback page stays lightweight and does not load React or Excalidraw.

### Stage 6 — remove the legacy boundary and consolidate shells

- Deleted `@tinytinkerer/app-bridge` and all frame/transport/harness helpers and tests.
- Removed bridge/protocol metadata roles and obsolete boundary rules.
- Moved common integrated-app hash routing and loading-screen construction into `app-browser`.
- Updated Canvas E2E coverage to interact with the direct stage, real chat/tool/controller path,
  IndexedDB persistence, and dock layout.
- Served Canvas from the composed host origin in E2E, eliminating the second preview server.
- Replaced legacy architecture documentation with [app-shell.md](../app-shell.md).

## Dependency shape

```text
apps/<app>
  ├─ @tinytinkerer/app-browser
  ├─ @tinytinkerer/app-shell
  └─ @tinytinkerer/<app>       (declared stagePackage)

@tinytinkerer/<app>
  └─ @tinytinkerer/app-shell   (generic stage infrastructure)
```

`app-shell` never imports a concrete app. `scripts/check-boundaries.mjs` enforces the manifest role
and dependency set for every integrated shell.

## Validation contract

The implementation is complete when:

- boundary, lint, type, unit, bundle, and production-build checks pass;
- Canvas startup chunks contain no Excalidraw modules;
- the lazy Excalidraw graph remains within its bundle budget;
- `/canvas/` contains no application iframe;
- Canvas reloads its IndexedDB snapshot and migrates valid legacy data without destructive failure;
- all workspace mounts are served from the composed host origin.
