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
- `edit.ts` — preflight, version checks, safe patches, atomic undoable updates, and edit receipts.
- `structure.ts` — group/ungroup, duplicate/delete, align/distribute/stack, layer reorder, and
  relationship-aware structural movement.
- `payload.ts` — exact UTF-8 size measurement and bounded string prefixes.

Keep `bridge.ts` as verb binding only: import the protocol contracts, wrap handlers with
`defineBridgeVerb(...)`, and create the bridge server with the Excalidraw app contract version.

All successful writes should call Excalidraw with `CaptureUpdateAction.IMMEDIATELY`. All failed writes
must leave the scene unchanged.

## 4. Wire the canvas shell description

Update `apps/canvas/src/canvas-runtime.ts` only for model-facing verb descriptions and schemas. The parent
shell may import `@tinytinkerer/excalidraw-protocol`; it must not import `@excalidraw/excalidraw` or
reimplement Excalidraw behavior.

## 5. Update docs and tests together

Update `docs/app-harness.md` when changing ownership, versioning, wire shapes, budgets, detail/pagination,
normalized read records, edit safety, or connector policy. Keep Mermaid diagrams valid.

Run focused tests first:

```bash
pnpm --filter @tinytinkerer/excalidraw-protocol test
pnpm --filter @tinytinkerer/excalidraw-app test
pnpm --filter @tinytinkerer/canvas test
```

Then run the relevant broader checks before pushing:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm format:check
pnpm check:mermaid
pnpm check:skill-readme
```
