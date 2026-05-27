<!--
This architecture document reflects the current implementation. This markdown file will reflect desired future architecture.
If changes affecting the architecture are made docs/ARCHITECTURE.md should be updated.
Do NOT delete above lines.
-->

# Architecture

This document describes the current TinyTinkerer architecture as it exists in the repo today. The frontend is split into three thin shells, a host-owned compositor, a shared browser composition package, and a dedicated assistant-content platform.

See also:
- [content-platform.md](./content-platform.md)
- [packages-concept.md](./packages-concept.md)
- [ui-ux-concept.md](./ui-ux-concept.md)

## Route Model

The deployed and local host serves four frontend entrypoints:

- `/` renders the host-owned composite workspace.
- `/web/` renders the full web shell.
- `/mobile/` renders the mobile shell.
- `/widget/` renders the standalone widget shell.

The root compositor is not a fourth app. It is a thin host page that embeds the real shells:

- web on the left
- mobile on the right in a device-style frame
- widget as a floating movable window

`/health`, `/api/*`, and `/auth/github/exchange` are still shared edge-facing routes and are proxied through the host in dev.

## Monorepo Map

```mermaid
flowchart LR
  subgraph Apps
    host["@tinytinkerer/host<br/>dev server + build compositor"]
    web["@tinytinkerer/web<br/>full browser UI shell"]
    widget["@tinytinkerer/widget<br/>embeddable browser UI shell"]
    mobile["@tinytinkerer/mobile<br/>mobile PWA shell"]
    edge["@tinytinkerer/edge<br/>stateless edge backend"]
  end

  common["Frontend Composition Layer"]

  subgraph Packages
    contracts["@tinytinkerer/contracts<br/>shared schemas + types"]
    agent["@tinytinkerer/agent-core<br/>runtime abstractions"]
    appcore["@tinytinkerer/app-core<br/>headless product logic + runtime facade"]
    appbrowser["@tinytinkerer/app-browser<br/>browser adapters + shell-facing exports"]
    brand["@tinytinkerer/brand-assets<br/>brand metadata + PWA assets"]
    ui["@tinytinkerer/ui<br/>presentational React primitives"]

    subgraph ContentPlatform["Content Platform"]
      contentcore["@tinytinkerer/content-core<br/>semantic AST + stable-ID helpers + contracts"]
      contentruntime["@tinytinkerer/content-runtime<br/>platform-agnostic coordinator + plugin contract"]
      contentmarkdown["@tinytinkerer/content-markdown<br/>markdown -> content AST + React adapter"]
      contentreact["@tinytinkerer/content-react<br/>React runtime impl + default plugins + chrome"]
      contentmermaid["@tinytinkerer/content-mermaid<br/>MermaidPlugin"]
      contentwireframe["@tinytinkerer/content-wireframe<br/>WireframePlugin"]
    end
  end

  host --> web
  host --> widget
  host --> mobile

  web --> common
  widget --> common
  mobile --> common

  common --> ui
  common --> appbrowser

  edge --> contracts
  appcore --> agent
  appcore --> contracts

  appbrowser --> contentmarkdown
  appbrowser --> contentmermaid
  appbrowser --> contentwireframe
  appbrowser --> appcore
  appbrowser --> contracts
  appbrowser --> brand

  contentruntime --> contentcore

  contentreact --> ui
  contentreact --> contentruntime
  contentreact --> contentcore

  contentmarkdown --> contentreact
  contentmermaid --> contentreact
  contentwireframe --> contentreact

  agent --> contracts
  brand --> contracts

  subgraph Legend
    direction LR
    legendUiApp["UI Apps"]
    legendHost["Build Compositor"]
    legendEdge["Edge Backend"]
    legendBrowser["Browser Assembly"]
    legendUi["UI Primitives"]
    legendFeature["Content Platform"]
    legendContracts["Shared Contracts"]
    legendCore["Headless Core"]
    legendBrand["Brand Assets"]

    legendHost ~~~ legendEdge ~~~ legendBrowser
    legendUi ~~~ legendFeature ~~~ legendContracts
    legendCore ~~~ legendBrand ~~~ legendUiApp
  end

  classDef uiApp fill:#dbeafe,stroke:#1d4ed8,color:#111827,stroke-width:2px;
  classDef hostInfra fill:#fed7aa,stroke:#c2410c,color:#111827,stroke-width:2px;
  classDef edgeApp fill:#fee2e2,stroke:#b91c1c,color:#111827,stroke-width:2px;
  classDef browserAssembly fill:#ccfbf1,stroke:#0f766e,color:#111827,stroke-width:2px;
  classDef uiPrimitives fill:#fef3c7,stroke:#b45309,color:#111827,stroke-width:2px;
  classDef sharedFeature fill:#e9d5ff,stroke:#7c3aed,color:#111827,stroke-width:2px;
  classDef contractsLayer fill:#dcfce7,stroke:#15803d,color:#111827,stroke-width:2px;
  classDef coreLayer fill:#e5e7eb,stroke:#6b7280,color:#111827,stroke-width:2px;
  classDef brandLayer fill:#ffe4e6,stroke:#be123c,color:#111827,stroke-width:2px;

  class web,widget,mobile,legendUiApp uiApp;
  class host,legendHost hostInfra;
  class edge,legendEdge edgeApp;
  class common,appbrowser,legendBrowser browserAssembly;
  class ui,legendUi uiPrimitives;
  class contentcore,contentruntime,contentmarkdown,contentreact,contentmermaid,contentwireframe,legendFeature sharedFeature;
  class contracts,legendContracts contractsLayer;
  class agent,appcore,legendCore coreLayer;
  class brand,legendBrand brandLayer;
```

## Design Principles

- Apps stay thin. `web`, `mobile`, and `widget` own routes, page composition, shell layout, and shell-specific UX, but not shared product behavior.
- Shared product behavior stays headless where possible. Core orchestration, projections, and runtime policies live in packages that do not depend on React or browser APIs.
- Shared browser-shell behavior has a single boundary. Browser-specific adapters, shell-facing React hooks and components, OAuth helpers, and shared browser styles live in `@tinytinkerer/app-browser`.
- Contracts are the wire source of truth. Shared request, response, event, and payload schemas live in `@tinytinkerer/contracts`.
- Rich assistant content is a dedicated subsystem. Markdown parsing, AST handling, and specialized renderers live in the content platform, not in apps and not in `ui`.

## Layers

| Layer | Purpose | Owns | Must not own |
| --- | --- | --- | --- |
| `apps/host` | frontend composition infrastructure | dev routing, build composition, root compositor page | shared runtime logic, app feature code |
| `apps/web` | full browser shell | routes, page composition, shell-local layout | copied shared runtime logic, direct lower-layer imports |
| `apps/widget` | embeddable browser shell | host integration, compact layout, widget window UX | copied shared runtime logic, direct lower-layer imports |
| `apps/mobile` | mobile browser shell | PWA shell, install affordances, narrow-screen layout | copied shared runtime logic, direct lower-layer imports |
| `apps/edge` | stateless backend boundary | HTTP endpoints, upstream normalization, transport concerns | browser APIs, UI logic |
| `packages/contracts` | shared wire contracts | schemas and DTOs | runtime orchestration, UI code |
| `packages/agent-core` | product-agnostic runtime abstractions | provider/tool abstractions, runtime mechanics | browser code, app-specific behavior |
| `packages/app-core` | headless product behavior | chat/auth/settings orchestration, projections, ports | React, browser APIs, fetch, storage adapters |
| `packages/app-browser` | shared browser composition boundary | browser adapters, shell bootstrap config, OAuth helpers, shell-facing hooks and components, shared browser styles | app-specific layout, app-owned screens |
| `packages/brand-assets` | shared brand metadata | favicon, icon, manifest, and theme definitions | DOM mutation, app bootstrapping |
| `packages/ui` | presentational primitives | buttons, icons, tiny visual atoms, styling helpers | feature runtimes, orchestration |
| `packages/content-*` | shared content platform | semantic content AST + stable IDs, platform-agnostic runtime coordinator, plugin contract, markdown parsing, default React plugins + chrome, specialized content plugins | app shells, transport contracts |

## Dependency Rules

- Browser apps (`web`, `widget`, `mobile`) may depend only on `@tinytinkerer/app-browser`, `@tinytinkerer/ui`, and their own local modules.
- Browser apps must not import `contracts`, `app-core`, `agent-core`, or any `content-*` package directly.
- `app-browser` may depend on `app-core`, `brand-assets`, `contracts`, `content-core` for DTO translation, and the outward-facing content packages (`content-markdown`, `content-mermaid`, `content-wireframe`). It must not depend on `content-react` or `content-runtime` directly.
- `brand-assets` may depend on `contracts` and nothing else.
- `content-core` must not depend on other workspace packages.
- `content-runtime` may depend only on `content-core`.
- `content-react` may depend only on `content-core`, `content-runtime`, and `ui`. It is the public facade for the React side of the content platform and re-exports the content-core symbols downstream content packages need.
- `content-markdown` may depend only on `content-core`, `content-react`, and local modules.
- `content-mermaid` and `content-wireframe` may depend only on `content-react` and local modules.
- `ui` must stay primitive-only.
- `app-core` may depend only on `agent-core`, `contracts`, and app-core-local modules.
- `agent-core` may depend only on `contracts` and agent-core-local modules.
- `edge` may depend only on `contracts` and edge-local modules.
- `host` must not declare workspace dependencies on other apps. It composes the built or dev-served apps by path, not by module import.

## Contracts And Data Flow

`@tinytinkerer/contracts` is the shared source of truth for:

- agent event schemas and types such as `ChatEvent`
- planning schemas such as `ExecutionPlan` and `PlanStep`
- edge DTOs such as `/health`, `/auth/github/exchange`, `/api/search`, and `/api/models/chat`
- rate-limit payloads shared between backend and browser layers

The current flow is:

1. A browser shell renders app-local layout and routes.
2. The shell consumes shared browser behavior from `@tinytinkerer/app-browser`.
3. `@tinytinkerer/app-browser` composes browser-backed implementations on top of `@tinytinkerer/app-core`.
4. `@tinytinkerer/app-core` orchestrates product behavior through ports and runtime abstractions.
5. `@tinytinkerer/agent-core` executes the agent runtime using product-agnostic abstractions.
6. Assistant synthesis still arrives from the model provider as markdown text, but `app-browser` now creates a markdown content session through `content-markdown` and emits structured assistant events with `{ source, content }`, where `content` is the wire-safe `AssistantContentDocument` DTO from `contracts`.
7. `AssistantContent` in `app-browser` translates that DTO into the internal semantic `ContentDocument`, applies the specialized Mermaid and wireframe plugins, and renders through the content platform.
8. `@tinytinkerer/edge` exposes stateless endpoints and returns payloads that conform to `contracts`.

## Browser App Model

All three browser shells consume the same browser-facing shared layer.

`@tinytinkerer/app-browser` currently owns:

- browser app creation and provider wiring
- shell bootstrap config resolution
- OAuth start and callback helpers
- shell-facing chat and settings controllers
- shared browser settings modal
- shared browser stylesheet
- `AssistantContent` for structured assistant content DTOs

The apps still own:

- routes
- page structure
- shell layout
- app-local copy
- shell-specific affordances such as install UX, widget window controls, and root-page embedding

This means TinyTinkerer has two different kinds of sharing:

- `app-core` stays headless
- `app-browser` is allowed to expose React hooks and components when that is the correct browser-shell reuse boundary

## Host Model

`apps/host` is both the local dev environment and the composed deployment surface for the frontends.

It is allowed to own:

- the root `/` compositor page
- iframe composition of the three real shells
- dev proxying and static asset composition
- host-local widget layout persistence for the composite workspace

It must not own:

- chat, auth, settings, or content feature logic
- app-to-app shared runtime code
- a second implementation of the browser shell

## Content Platform

- `content-core` owns the semantic AST (block + inline node types) plus stable identity helpers (`computeNodeId`, `assignNodeIds`) used by parsers and renderers. Inline nodes now participate in the shared identity contract.
- `content-runtime` owns the platform-agnostic `ContentRuntime<TResult>` coordinator and the `NodeRendererPlugin` contract. It resolves competing plugins per node type by `priority` + `matches(node)`, enforces execution policy, orchestrates lazy `load()` calls via `prepareNode()` / `prepareDocument()`, and routes structured failure reasons through host-supplied fallback + wrap hooks. It has no React dependency.
- `content-markdown` parses markdown into the semantic `ContentDocument`, emits Mermaid and wireframe fences as `codeBlock` nodes with specialized `language` values, exposes a thin `MarkdownContent` adapter over the React runtime, and provides `createMarkdownContentSession()` for parser-side streaming snapshots.
- `content-react` provides `createReactContentRuntime`, the default React plugins (paragraph, heading, list, blockquote, thematicBreak, codeBlock, table, image), the inline renderer, and the shared chrome (`PreviewCodeFrame`, `CodeBlockFallback`). `ContentDocumentRenderer` normalizes missing ids through `assignNodeIds()` for blocks, list items, and inline nodes, then uses Suspense plus a render error boundary around runtime-managed node preparation.
- `content-mermaid` and `content-wireframe` export singleton convenience plugins plus `createMermaidPlugin()` / `createWireframePlugin()` factory helpers for runtime-scoped plugin instances. Mermaid still ships its heavy runtime as a separately code-split chunk loaded on first use.
- `contracts` now own the assistant-facing `AssistantContentDocument` DTO, while the internal semantic AST remains the content platform's runtime/parser model.
