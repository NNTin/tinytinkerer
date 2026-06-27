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

Work on the isolated Excalidraw iframe app, the thin canvas harness shell, or the
assistant verbs connecting them. Read `../../README.md` first for the WAT framework.

## When to use

- Changing `apps/excalidraw-app` or `apps/canvas`.
- Adding or modifying the `draw`, `read`, or `clear` assistant verbs.
- Using the Excalidraw imperative API or changing its bundle boundary.

## Architecture

- `packages/shared/excalidraw-protocol` owns the app id, protocol version,
  advertised verbs, and Zod input/result contracts used by both sides.
- `apps/canvas` is a thin browser shell. It declares model-facing verb
  descriptions, converts them to app tools, and renders `HarnessShell`.
- `apps/excalidraw-app` owns `@excalidraw/excalidraw`, mounts the component, and
  binds inferred handlers with `defineBridgeVerb`.
- The iframe is mounted with `sandbox="allow-scripts"` and communicates only via
  `@tinytinkerer/app-bridge`, correlated by parent/frame identity and the nonce in
  the URL fragment.

Never import Excalidraw from the canvas shell or another chat shell. All of its
runtime code, license exceptions, advisory exceptions, and bundle tests belong to
`apps/excalidraw-app`.

## Reference workflow

1. Run `node .agent/skills/excalidraw/tools/excalidraw-ref.mjs [query]`.
2. Confirm the API contract in the read-only `~/excalidraw` clone.
3. Update the shared schema, app-side handler, shell verb description, and tests
   together; follow `workflows/wire-excalidraw-api-call.md`.
4. Run the Excalidraw app and canvas bundle tests to preserve isolation.

## Current verbs

| Verb    | Direction | Implementation                                                  |
| ------- | --------- | --------------------------------------------------------------- |
| `draw`  | WRITE     | `convertToExcalidrawElements`, `updateScene`, `scrollToContent` |
| `read`  | READ      | capped `getSceneElements` plus compact `getAppState`            |
| `clear` | WRITE     | undoable `updateScene({ elements: [] })`                        |

Assistant writes use `CaptureUpdateAction.IMMEDIATELY` so the user can undo them.
Read results must remain compact and serializable.

## Success criteria

Inputs and results are validated, writes are undoable, missing verbs or
mismatched iframes fail during handshake, Excalidraw stays out of all chat-shell
bundles, and the iframe app's bundle/compliance checks pass.
