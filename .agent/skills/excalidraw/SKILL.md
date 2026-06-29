# excalidraw

<!-- BEGIN GENERATED: .agent/README.md — do not edit; run `pnpm sync:skill-readme`

# `.agent` — WAT skills (Workflow · Agent · Tools)

Skills the agent uses to work in this repo. Core idea: **offload deterministic steps to scripts so you stay focused on decisions.** Chained 90%-accurate manual steps decay fast (0.9^5 ≈ 59%) — scripts don't drift, and they save tokens.

## Skill layout

```
.agent/skills/<skill-name>/
  SKILL.md      # when to use, how, available tools, constraints, success criteria
  workflows/    # OPTIONAL: markdown SOPs (some skills are just SKILL.md + tools/)
  tools/        # deterministic scripts SKILL.md / the workflows call
```

## How you (the agent) work

1. Match the task to a skill, read its `SKILL.md`.
2. If it has `workflows/`, scan their **filenames** for a relevant SOP — don't read every file.
3. Follow `SKILL.md` (and the SOP, if any); run the tool scripts instead of doing the steps by hand.
4. **Self-evolve:** if you solved something repeatable the hard way, capture it as a new workflow SOP (+ tool). Future agents thank you.

END GENERATED: .agent/README.md -->

This skill is for implementation agents changing TinyTinkerer's Excalidraw integration. It is **not**
a chat-assistant prompt or usage guide for drawing on the canvas. Use it to modify contracts, handlers,
tool wiring, iframe lifecycle, tests, and docs without breaking package ownership or bundle isolation.

## When to use

- Changing `packages/shared/excalidraw-protocol`, `packages/app/excalidraw-app`, or `apps/canvas`.
- Adding, removing, or changing Excalidraw assistant verbs or their model-facing descriptions.
- Touching Excalidraw imperative API calls, element normalization, edit safety, connector layout, budgets,
  pagination, versioning, or the isolated iframe build.
- Investigating rendering bugs caused by generated Excalidraw elements or connector coordinates.

## Required references

Read the relevant sections before designing or implementing:

- `docs/app-harness.md` — source of truth for Excalidraw package relationships, generic bridge vs app
  contract versions, verbs, detail levels, pagination, payload budgets, connector policy, iframe lifecycle,
  and the internal `excalidraw-app` module split.
- `docs/ARCHITECTURE.md` — dependency rules and the monorepo package map. In particular, `app-bridge`
  is generic and product-agnostic; app-specific contracts live in the app protocol package.
- `docs/packages-concept.md` — why apps stay thin, what app-harness packages own, and when behavior
  belongs in shared packages versus deployable shells.
- `workflows/wire-excalidraw-api-call.md` — SOP for wiring a new or changed API capability end to end.

## Ownership map

- `packages/shared/excalidraw-protocol` owns `EXCALIDRAW_APP_ID`, `EXCALIDRAW_PROTOCOL_VERSION`,
  `EXCALIDRAW_VERBS`, Zod input/result contracts, payload budgets, detail levels, pagination fields,
  truncation metadata, normalized result variants, and edit capability vocabulary. It must remain small,
  serializable, side-effect-free, and independent of `@tinytinkerer/app-bridge`.
- `packages/app/excalidraw-app` owns every import from `@excalidraw/excalidraw`, all interaction with
  `ExcalidrawImperativeAPI`, and app-domain behavior. Keep implementation in focused internal modules:
  `create.ts` for draw/clear and connector endpoint generation, `query.ts` for search/inspect/read and
  budgets, `normalization.ts` for normalized element records and capabilities, `edit.ts` for atomic
  versioned edits, and `payload.ts` for exact UTF-8 measurement/truncation. Keep `bridge.ts` limited to
  `defineBridgeVerb(...)` binding and server creation.
- `apps/canvas` owns the deployable canvas shell, iframe URL, app id/version wiring, and model-facing
  verb descriptions in `src/canvas-runtime.ts`. It may import Excalidraw contracts, but it must never
  import `@excalidraw/excalidraw` or reimplement app-domain behavior.
- `packages/shared/app-bridge` and `packages/app/app-harness` are generic. They must not know Excalidraw
  verb names, schemas, element kinds, or behavior.
- `apps/widget` is a chat-only sibling. Do not add Excalidraw protocol, bridge, or harness dependencies
  there unless the architecture docs are intentionally changed first.

## Contract and implementation rules

- Bump `EXCALIDRAW_PROTOCOL_VERSION` for incompatible app-contract changes: verb names, required inputs,
  result shapes, normalized variants, budgets, or semantics that older canvas code cannot safely consume.
  Do not bump `APP_BRIDGE_PROTOCOL_VERSION` unless the generic bridge envelope changes.
- Zod schemas are the wire source of truth. Validate inputs before app code and results before returning
  through the bridge. Keep data JSON-serializable and model-friendly; do not expose raw Excalidraw seeds,
  nonces, React state, functions, DOM objects, or module instances.
- Read paths must stay bounded. Preserve `detail`, `offset`, `limit`, `expectedSceneVersion`, `page`,
  `sceneVersion`, and `truncation` behavior unless the contract version and docs are updated together.
- `read` returns a strict discriminated union over normalized element `kind`s and per-element
  `capabilities`. Any edit capability advertised by `read` must be enforced by `edit` using the same
  capability calculation.
- Writes must be undoable with `CaptureUpdateAction.IMMEDIATELY`. Reject stale, locked, missing, or
  relationship-unsafe edit batches before any partial `updateScene`.
- Use the safe iterative ladder for modifying existing drawings: `search` → `inspect` → `read` → `edit`.
  `edit` requires the current element version from `read`; retry stale edits only after reading again.
- For generated diagrams, prefer declarative `draw.connectors` over hand-built arrow coordinates.
  Horizontal row links use a shared `rowY` so `startY === endY`; vertical trunks use a shared `trunkX` so
  `startX === endX`. Connector endpoints are computed after node conversion from final bounds.

## Current verbs

| Verb      | Direction | Implementation focus                                                                  |
| --------- | --------- | ------------------------------------------------------------------------------------- |
| `draw`    | WRITE     | Element skeletons, stable ids, post-layout connectors, undoable scene update          |
| `search`  | READ      | Capped candidates by query, type, selection, or viewport                              |
| `inspect` | READ      | Compact scene, viewport, selection, grouping, z-order, locking, and relationships     |
| `read`    | READ      | Budgeted normalized discriminated element records, capabilities, versions, pagination |
| `edit`    | WRITE     | Atomic, version-checked, invariant-safe patches with compact receipts                 |
| `clear`   | WRITE     | Undoable `updateScene({ elements: [] })`                                              |

## Useful tools and checks

Use the local Excalidraw reference helper before relying on memory of upstream APIs:

```bash
node .agent/skills/excalidraw/tools/excalidraw-ref.mjs
node .agent/skills/excalidraw/tools/excalidraw-ref.mjs convertToExcalidrawElements
node .agent/skills/excalidraw/tools/excalidraw-ref.mjs updateScene
```

Focused validation for protocol, iframe app, and canvas shell changes:

```bash
pnpm --filter @tinytinkerer/excalidraw-protocol test
pnpm --filter @tinytinkerer/excalidraw-protocol typecheck
pnpm --filter @tinytinkerer/excalidraw-protocol lint
pnpm --filter @tinytinkerer/excalidraw-app test
pnpm --filter @tinytinkerer/excalidraw-app typecheck
pnpm --filter @tinytinkerer/excalidraw-app lint
pnpm --filter @tinytinkerer/canvas test
pnpm --filter @tinytinkerer/canvas typecheck
```

Repository-level validation before pushing substantial Excalidraw work:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm check:mermaid
pnpm check:skill-readme
```

## Success criteria

- Contracts, handlers, model-facing descriptions, docs, and tests move together.
- Excalidraw runtime code remains isolated to `packages/app/excalidraw-app` and its iframe build.
- Generic bridge/harness packages remain app-agnostic.
- Reads are validated, paginated, compact, budgeted, and safe to serialize.
- Writes are atomic, undoable, version-aware, and do not corrupt relationship-sensitive elements.
- Generated connectors use one post-layout anchoring policy per route and expose receipts that let callers
  verify horizontal/vertical invariants.
- Bundle-isolation, boundary, skill README, Mermaid, lint, typecheck, and tests pass for the touched scope.
