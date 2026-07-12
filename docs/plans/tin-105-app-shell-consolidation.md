# tin-105 — App-shell consistency & shared-code consolidation

**Status:** Phase 1 answered — refined plan below. No code changed yet.
**Base:** develop @ `2d37e64`.
**Scope:** the three workspace apps — canvas (Excalidraw), IDE, mermaid — their shells, and the shared packages under them.

Two goals from the brief:

1. **Shell consistency** — reconcile the two composition styles (iframe "app harness shell" vs the newer "integrated app shells"), using the integrated shells consistently _where appropriate_ while respecting canvas's hard security reason for the iframe.
2. **Clear division + shared code** — the three apps cleanly separated, genuinely-common functionality factored into shared packages.

This builds on PR #422 (issue #403), which already extracted `packages/shared/file-tools` and added `packages/app/app-harness/src/dockable-panel-layout.tsx`. Those are **not** re-proposed here.

---

## 1. Analysis

### 1.1 The two (really three) composition styles today

| App         | Role (`package.json`)                                      | Boot path                                                                                                                                            | Chat composition                                           | Tool transport                               | Isolation                                                                     |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| **canvas**  | `harness-shell`                                            | `main.tsx` → `createBrowserShellRoot({appToolGroup})` → `router` → `CanvasPage` → `HarnessShell` → `AppStageShell` + `AppFrame`                      | `AppStageShell` overlay (floating→dockable)                | `AppBridgeHandle` → app-bridge `postMessage` | **Sandboxed iframe, opaque origin**                                           |
| **IDE**     | `integrated-shell` (`stagePackage: @tinytinkerer/ide`)     | `main.tsx` → `createBrowserShellRoot({appToolGroup})` → `router` → `IdePage` → `AppStageShell` + `IdeStage`                                          | `AppStageShell` overlay (sidebar)                          | `ideControllerHandle` (in-process)           | Trusted React stage; exec isolated inside Sandpack's own cross-origin runtime |
| **mermaid** | `integrated-shell` (`stagePackage: @tinytinkerer/mermaid`) | `main.tsx` → `createBrowserShellRoot({appToolGroup})` → `router` → `MermaidPage` → `MermaidStage` (`assistant={<ChatApp/>}`) → `DockablePanelLayout` | **`DockablePanelLayout`** — chat is 1 of 3 dockable panels | `mermaidControllerHandle` (in-process)       | Trusted React stage; only sanitized SVG enters the DOM                        |

**Observation:** there are not two but effectively **three** assembly shapes. canvas and IDE both use `AppStageShell` (chat overlay); mermaid uses `DockablePanelLayout` (chat docked as an equal panel). The integrated model is itself internally inconsistent.

### 1.2 What each app owns vs shared vs duplicated

**Genuinely shared today (healthy):**

- `@tinytinkerer/file-tools` — `read_files`/`apply_file_changes` schemas + `createFileTools` + `applyWorkspaceChanges` + revisions + `FileDiagnostic`. Consumed by both IDE (`ide-stage.tsx`, `workspace-changes.ts` re-export, `contracts.ts` re-export) and mermaid (`mermaid-stage.tsx`, `tools.ts`). (PR #422.)
- `@tinytinkerer/app-browser` — `createBrowserShellRoot`, `ChatApp`, `BrowserCallbackPage`. All three.
- `@tinytinkerer/app-harness` — `AppFrame`, `HarnessShell`, `AppStageShell`, `DockablePanelLayout`, `AppBridgeHandle`, `appToolsFromVerbs`.
- `@tinytinkerer/app-bridge`, `@tinytinkerer/excalidraw-protocol` — canvas only (correct).

**Owned (correct, app-specific):**

- canvas: Excalidraw tool descriptions (`canvas-runtime.ts`), library relay (`library-relay.ts`), iframe build entry.
- IDE: Sandpack stage + file tree + IDE controller (`ide-stage.tsx`, `file-tree.ts`, `controller.ts`).
- mermaid: CodeMirror editor + Mermaid render/validate + fix-prompt (`mermaid-stage.tsx`, `fix-prompt.ts`).

**Duplicated / tangled (the actual targets):**

| #   | Smell                                                             | Evidence                                                                                                                                                                                                                       | Why it's a problem                                                                                                                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **In-process controller-handle pattern duplicated**               | `packages/app/ide/src/controller.ts:21-45` (`createIdeControllerHandle`) vs `packages/app/mermaid/src/controller.ts:15-31` (`createMermaidControllerHandle`)                                                                   | Both hold a nullable controller, expose `request(method,input)→Promise`, reject-while-loading, normalize thrown errors. Near-identical. It's the in-process twin of `bridge-handle.ts`'s `AppBridgeHandle` — three hand-rolled "call the app's verbs" handles for one concept.                                                    |
| D2  | **Dexie IndexedDB persistence boilerplate duplicated**            | `packages/app/ide/src/workspace-db.ts` vs `packages/app/mermaid/src/workspace-db.ts`                                                                                                                                           | Identical `Dexie` subclass, `version(1).stores({workspaces:'id,updatedAt'})`, try/catch `get`, `put`. Only the DB name + record type differ.                                                                                                                                                                                      |
| D3  | **`DockablePanelLayout` mis-homed + not app-agnostic**            | Lives in `packages/app/app-harness/` (the _iframe host_), hardcodes `<strong>Mermaid workspace</strong>` at `dockable-panel-layout.tsx:297`                                                                                    | A generic 3-panel dock layout with nothing to do with iframe hosting. Because it lives in `app-harness`, the _trusted_ `@tinytinkerer/mermaid` stage package must depend on `@tinytinkerer/app-harness` (see its `package.json`) purely to get a layout. And the hardcoded label means it isn't actually reusable/agnostic.       |
| D4  | **`app-harness` conflates two concerns**                          | `app-harness/src/index.ts` exports both iframe pieces (`AppFrame`, `HarnessShell`, `AppBridgeHandle`, `appToolsFromVerbs`) and generic composition/layout (`AppStageShell`, `DockablePanelLayout`)                             | Its declared role (docs/ARCHITECTURE.md layer table) is "iframe-app hosting boundary." Generic chat+stage composition and dock layout are a _different_ concern that integrated (non-iframe) shells and stages consume. IDE-shell + mermaid-shell + the mermaid stage all depend on `app-harness` without ever hosting an iframe. |
| D5  | **mermaid reaches into runtime internals for "assistant action"** | `apps/mermaid/src/mermaid-page.tsx:7-8` — `useBrowserApp()` then `app.stores.chat.getState().sendPrompt(prompt)`; wired to `onRequestAssistantFix` in `mermaid-stage.tsx:200-211`                                              | Sending a prompt into chat from a stage isn't a first-class shell API; mermaid pokes app-browser store internals. There's no shared "request an assistant action from the stage" seam, so any similar IDE feature would re-invent it.                                                                                             |
| D6  | **Per-app shell boilerplate duplicated** (minor)                  | `apps/*/src/app/router.tsx` (3× near-identical hash router `/` + `/auth/callback`), `apps/*/src/callback-page.tsx` (3× identical `export { BrowserCallbackPage as default }`), `apps/*/src/app/loading-screen.tsx`, `main.tsx` | Thin-shell boilerplate; individually cheap but triplicated. Candidate for a shared `createAppShellRouter` helper — low priority.                                                                                                                                                                                                  |

### 1.3 Shell-model correctness (goal 1 — which app on which model, and why)

- **canvas → stays on the harness/iframe model. Non-negotiable.** Excalidraw is mounted in a sandboxed iframe with an **opaque origin** (`sandbox` without `allow-same-origin`), so it cannot touch the parent DOM, storage, cookies, or auth; trust rests on window identity + a per-mount session nonce (docs/app-harness.md "Security boundary"). The iframe also keeps Excalidraw's large third-party dependency graph and its license/advisory allow-list **out of the chat startup graph** (enforced by `apps/canvas/src/bundle-size.test.ts`). Unifying canvas onto the in-process model would collapse both protections. **Do not move canvas.**
- **IDE + mermaid → correctly stay integrated (trusted in-process stage).** IDE's _executable_ user code already runs inside Sandpack's own cross-origin runtime, so the stage itself needs no second postMessage boundary; mermaid only injects SVG that has passed Mermaid strict mode + the shared sanitizer. Neither warrants the iframe/bridge tax. **Keep them integrated.**
- **Therefore the shell-consistency work is _within_ the integrated model, not canvas-vs-integrated.** The thing to reconcile is D3/D4 (where the shared composition lives) and the IDE-overlay vs mermaid-dock split (§1.1) — not the iframe boundary.

---

## 2. Proposed target architecture

### 2.1 Separate "generic app composition" from "iframe hosting"

Introduce a shared composition/layout boundary that both the harness and the integrated stages sit on, so the iframe concern stops leaking into trusted stages.

- **New package `@tinytinkerer/app-shell`** (name TBD — see Q2) owns the **framework/composition primitives**: `AppStageShell` (chat overlay: floating ⇄ dockable) and `DockablePanelLayout` (generic 3-panel dock), with the hardcoded "Mermaid workspace" label lifted to a `title` prop (D3 fix).
- **`@tinytinkerer/app-harness` keeps only the iframe concern**: `AppFrame`, `HarnessShell`, `AppBridgeHandle`, `appToolsFromVerbs`, snapshot storage. It depends on `@tinytinkerer/app-shell` for `AppStageShell` (which `HarnessShell` wraps).
- **Integrated shells + stages depend on `@tinytinkerer/app-shell`, not `app-harness`.** IDE-shell/mermaid-shell import `AppStageShell`/`DockablePanelLayout` from the new package; the mermaid _stage_ stops depending on `app-harness` entirely.
- **Boundary rules updated** in `scripts/check-boundaries.mjs`: `integrated-shell` may depend on `app-shell` (instead of / in addition to `app-harness`); `app-harness` may depend on `app-shell`; the new package may depend on `app-browser` (it renders `ChatApp`).

This gives the clean division the brief asks for: **iframe hosting** (`app-harness` + `app-bridge` + `*-protocol` + `*-app`) is a distinct subsystem from **in-process app composition** (`app-shell`), and trusted stages never touch the former.

### 2.2 Factor the duplicated in-process plumbing

- **Shared in-process controller handle** (D1): a generic `createStageControllerHandle<TController>()` — set/clear a controller, `request(method, input)`, reject-while-loading, error-normalize. It's framework-agnostic. Home options: the new `app-shell` package, or a tiny `@tinytinkerer/stage-core` leaf (see Q3). IDE keeps its `undo/redoLastChange` convenience methods as a thin extension over the generic handle.
- **Shared Dexie workspace store** (D2): a generic `createWorkspaceStore<T>(dbName)` returning `{ load, save }` over the `{ workspaces: 'id,updatedAt' }` table with the fail-safe try/catch. **Must be browser-facing** — it cannot live in `file-tools` (whose layer contract forbids browser storage), so it belongs in `app-shell`/`stage-core`.

### 2.3 (Optional) unify the integrated composition + assistant-action seam

Gated on the human's answers (Q1/Q4):

- Decide whether IDE and mermaid share **one** configurable "workspace shell" (overlay _or_ dock chosen by prop) or keep two deliberate shapes over shared primitives. IDE (editor+preview+console+tree, chat overlay) and mermaid (editor/preview/chat as three equal dockable panels) have genuinely different UX; forcing them identical may hurt both.
- Add a first-class **"request assistant action"** seam (e.g. a callback passed through the shell) so the mermaid fix-prompt flow (and any IDE equivalent) stops reaching into `app.stores.chat` (D5).

### 2.4 End-state division

- **canvas** — iframe/harness subsystem, Excalidraw-only. Unchanged model.
- **IDE + mermaid** — trusted stages on shared `app-shell` composition + shared controller-handle + shared workspace-store; each owns only its domain (Sandpack vs CodeMirror+Mermaid) and its verbs.
- **Shared** — `file-tools` (files), `app-shell` (composition/layout/handle/storage), `app-browser` (chat surface), `app-harness`+`app-bridge`+`excalidraw-protocol` (iframe only).

---

## 3. Staged, incremental refactor plan

Each stage is independently mergeable, behavior-preserving, and must keep `typecheck + lint + check:boundaries + knip + format:check + unit + e2e` green (husky must pass; **no `--no-verify`**). Ordered low-risk → higher-risk.

- **Stage 1 — De-Mermaid-ify `DockablePanelLayout`.** Lift the hardcoded `"Mermaid workspace"` toolbar string to a `title?: string` prop; mermaid-stage passes it. Pure, tiny, no behavior change. (Fixes half of D3.) _Independent of everything else._
- **Stage 2 — Extract `@tinytinkerer/app-shell`** from `app-harness` (move `AppStageShell` + `DockablePanelLayout`; `app-harness` re-exports or callers re-point). Update `check-boundaries.mjs` roles + the ARCHITECTURE.md layer table + app-harness.md. Repoint IDE-shell, mermaid-shell, and the mermaid stage; drop the mermaid stage's `app-harness` dep. (Fixes D3/D4.) The structural core — verify boundaries + all bundle-size guards stay green.
- **Stage 3 — Shared in-process controller handle.** Add `createStageControllerHandle`; refactor `ide/controller.ts` + `mermaid/controller.ts` onto it (IDE keeps its undo/redo extras). (Fixes D1.) IDE controller unit tests already exist as a safety net.
- **Stage 4 — Shared Dexie workspace store.** Add `createWorkspaceStore`; refactor both `workspace-db.ts`. (Fixes D2.)
- **Stage 5 — (optional, needs sign-off) Integrated-composition consistency + assistant-action seam.** Per Q1/Q4: either converge IDE+mermaid onto one configurable workspace shell, or formalize the two shapes; add the shared "request assistant action" seam (Fixes D5). UX-touching → explicit human approval.
- **Stage 6 — (optional, low priority) Shared shell boilerplate** (`createAppShellRouter` etc.) to collapse D6.

Stages 1–4 are behavior-preserving structural cleanups. Stages 5–6 are optional and depend on appetite.

---

## 4. Human decisions (answers to Phase-1 questions)

1. **Scope:** full — do all the shared-code extraction **and** the boilerplate consolidation. _But_ per decision 4, do **not** homogenize the two apps' UX.
2. **Package structure — decisive redirection:** do **not** keep `app-harness` as a separate iframe-only package. Collapse everything currently in `@tinytinkerer/app-harness` into a single new **`@tinytinkerer/app-shell`** package and **delete `@tinytinkerer/app-harness`**. `app-shell` owns both the iframe-hosting pieces (`AppFrame`, `HarnessShell`, `AppBridgeHandle`, `appToolsFromVerbs`, snapshot storage) and the generic composition (`AppStageShell`, `DockablePanelLayout`). Canvas and both integrated shells all depend on `app-shell`.
3. **Shared helpers home:** the `app-shell` package — `createStageControllerHandle` + `createWorkspaceStore` live there alongside the composition primitives.
4. **Integrated UX:** keep both shapes exactly — IDE stays a chat **overlay** (`AppStageShell`), mermaid stays **dockable 3-panel** (`DockablePanelLayout`). Share primitives/handle/storage only; do **not** build a single converged workspace shell. Preserve current look & feel. (Still add the shared "request assistant action" seam so mermaid's fix-prompt stops poking `app.stores.chat` — D5.)

### Refined target package map

- **`@tinytinkerer/app-shell`** (new; replaces `app-harness`, lives at `packages/app/app-shell`): `AppFrame`, `HarnessShell`, `AppBridgeHandle`, `appToolsFromVerbs`, snapshot storage, `AppStageShell`, `DockablePanelLayout` (with `title` prop), `createStageControllerHandle`, `createWorkspaceStore`, and the assistant-action seam type. Depends on `app-browser` + `app-bridge`.
- **`@tinytinkerer/app-harness`** — **deleted.**
- Boundary rules (`check-boundaries.mjs`) + `ARCHITECTURE.md` + `app-harness.md` updated: `harness-shell` and `integrated-shell` may depend on `app-shell`; `app-shell` may depend on `app-browser` + `app-bridge`. The mermaid _stage_ drops its `app-harness` dep (uses `app-shell`).

### Refined stage order (each its own PR; behavior-preserving unless noted)

- **Stage 1 — `DockablePanelLayout` `title` prop** (de-Mermaidify). Tiny, in place, before the move.
- **Stage 2 — Rename `app-harness` → `app-shell`** (git-mv the package; repoint canvas, IDE-shell, mermaid-shell, mermaid stage; update boundaries + docs; delete `app-harness`). Pure move/rename, no behavior change. Verify boundaries + every `bundle-size.test.ts` stays green.
- **Stage 3 — Shared `createStageControllerHandle`** in `app-shell`; refactor `ide/controller.ts` + `mermaid/controller.ts` (IDE keeps undo/redo extras).
- **Stage 4 — Shared `createWorkspaceStore`** (Dexie) in `app-shell`; refactor both `workspace-db.ts`.
- **Stage 5 — Assistant-action seam** (D5 only, **not** UX convergence): a first-class callback through the shell so mermaid's fix-prompt no longer reaches into `app.stores.chat`. Keep both UX shapes untouched.
- **Stage 6 — Shared shell boilerplate** (`createAppShellRouter` + shared callback/loading wiring) to collapse D6 across all three apps.

Implemented as separate incremental PRs vs develop. Implementation via Sonnet subagents; architecture owned here.
