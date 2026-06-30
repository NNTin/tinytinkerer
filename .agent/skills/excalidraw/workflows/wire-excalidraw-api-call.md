# Wire an Excalidraw API capability through the iframe bridge

Use this workflow when adding or changing an Excalidraw verb, extending an existing verb, or fixing a
bug that crosses protocol, iframe implementation, and canvas tool wiring.

## 1. Confirm upstream Excalidraw behavior

Do not rely on memory for Excalidraw APIs or element shapes. Inspect the pinned package docs/types and,
when useful, the read-only upstream clone:

```bash
node .agent/skills/excalidraw/tools/excalidraw-ref.mjs
node .agent/skills/excalidraw/tools/excalidraw-ref.mjs <api-or-type-name>
```

Also check the installed package types under `@excalidraw/excalidraw/dist/types` when the public docs do
not answer a signature or element-field question.

## 2. Update the app-owned protocol first

Define the smallest model-friendly, JSON-serializable input/result change in
`packages/shared/excalidraw-protocol`.

- Keep Zod schemas as the source of truth.
- Preserve payload budgets, detail levels, pagination, scene-version checks, and truncation metadata for
  read-like operations.
- Preserve discriminated normalized element variants and per-element capabilities for read results.
- Bump `EXCALIDRAW_PROTOCOL_VERSION` for incompatible app-contract changes.
- Do not import `@tinytinkerer/app-bridge` or `@excalidraw/excalidraw` from the protocol package.

## 3. Implement inside `packages/app/excalidraw-app`

Put app behavior in the focused internal module that owns the concern:

- `create.ts` — draw, clear, stable ids, and post-layout connector endpoint generation.
- `query.ts` — search, inspect, read, scene snapshots, pagination, and result budgets.
- `normalization.ts` — normalized element records, bounds, labels, relationships, and capabilities.
- `edit.ts` — preflight, version checks, safe field patches, atomic undoable updates, and edit receipts.
- `structure.ts` — the structural verbs (`group`, `duplicate`, `delete`, `align`, `distribute`, `stack`,
  `order`, `transform`): operand resolution from ids or live selection, version/relationship preflight, one
  undoable update each.
- `mutation.ts` — shared receipt + budget-bounded normalized record helper (used by `edit` **and**
  `structure`); reuse it instead of re-deriving receipts/budgets.
- `ids.ts` — collision-free id minting (used by `create` **and** `structure`).
- `payload.ts` — exact UTF-8 size measurement and bounded string prefixes.

Keep `bridge.ts` as verb binding only: import the protocol contracts, wrap handlers with
`defineBridgeVerb(...)`, and create the bridge server with the Excalidraw app contract version. Add no
behavior here — it is the audited transport seam.

All successful writes call Excalidraw with exactly one `updateScene(..., { captureUpdate:
CaptureUpdateAction.IMMEDIATELY })`. All failed writes must leave the scene unchanged (reject during
preflight, before any partial update).

## 4. Wire the canvas shell description

Update `apps/canvas/src/canvas-runtime.ts` only for model-facing verb descriptions and the input schema
binding (via `appToolsFromVerbs`). The parent shell may import `@tinytinkerer/excalidraw-protocol`; it must
not import `@excalidraw/excalidraw` or reimplement Excalidraw behavior. If you added or removed a verb,
update the tool-count guard and size budget in `apps/canvas/src/bundle-size.test.ts` (currently asserts the
"fourteen-tool startup entry").

## 5. Check boundaries

Run the boundary check explicitly — it governs the package architecture roles (`app-protocol`,
`iframe-app`, `harness-shell`) and forbids workspace-subpath imports, app-to-app imports, and any consumer
of the iframe package other than its declaring harness shell entry:

```bash
pnpm check:boundaries
```

## 6. Add tests, then update docs

Add/extend tests with the change:

- `packages/shared/excalidraw-protocol/tests/protocol.test.ts` — input/result schema acceptance, rejection,
  defaults, and version-gating for the new/changed verb.
- `packages/app/excalidraw-app/tests/structure.test.ts` (structural verbs) or the matching module test —
  cover the version-mismatch reject, relationship-safety reject, live-selection fallback, and the atomic
  single-`updateScene` commit.
- `packages/app/excalidraw-app/tests/bridge.test.ts` — the new verb is bound in `bridge.ts`.
- `apps/canvas/src/canvas-runtime.test.ts` + `bundle-size.test.ts` — description/schema wiring and the
  tool-count/bundle guards.

Update `docs/app-harness.md` when changing ownership, versioning, wire shapes, budgets, detail/pagination,
normalized read records, edit/structure safety, or connector policy. Keep its Mermaid diagrams (and the one
in `SKILL.md`) valid and in step.

Run focused tests first:

```bash
pnpm --filter @tinytinkerer/excalidraw-protocol test
pnpm --filter @tinytinkerer/excalidraw-app test
pnpm --filter @tinytinkerer/canvas test
```

Then the broader checks before pushing (husky pre-commit runs these — never `--no-verify`):

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm check:boundaries
pnpm check:mermaid
pnpm check:skill-readme
```
