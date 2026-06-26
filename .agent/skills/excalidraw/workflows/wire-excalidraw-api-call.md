# Wire a new Excalidraw API call into the widget

SOP for exposing one Excalidraw `excalidrawAPI` capability to the chat assistant (the chat ⇄ canvas bridge). Assumes `<Excalidraw>` is already embedded and its `excalidrawAPI` handle is held in a store. Use it once per capability (one READ or one WRITE call at a time — ship READ before WRITE).

## Precondition: is Excalidraw embedded yet?

If `apps/widget` does not yet render `<Excalidraw>`, that is a **prerequisite, separate change** (and the dep add is human-approved — see `../SKILL.md` "npm package"). Do the embed first:

1. Lazy-mount it (`React.lazy` / dynamic `import()`) so it lands in its own chunk — `apps/widget/src/bundle-size.test.ts` will fail otherwise.
2. Import `@excalidraw/excalidraw/index.css` alongside the component.
3. Capture the handle: `<Excalidraw excalidrawAPI={(api) => store.set(api)} />` (no `ref` — removed in v0.17).
4. Give the container non-zero width/height (Excalidraw fills 100% of its parent).

## Steps for one API call

1. **Confirm the contract in the reference.** `node .agent/skills/excalidraw/tools/excalidraw-ref.mjs <callName>`, then read the cited `dev-docs` file. Copy the exact signature and argument/return shapes — do not invent fields.
2. **Classify READ vs WRITE** using the API map in `../SKILL.md`. This decides the tool's risk and shape.
3. **Define the tool.** Add a `Tool<Input, Output>` (from `@tinytinkerer/app-core`) that closes over the live `excalidrawAPI`, following the existing tool wiring in `packages/app/app-browser/src/runtime/` (`mcp-tool.ts` is the closest reference for shape + the activity-summary mapping; `tool-calling.ts` shows how tools are advertised to the model).
   - Give it a tight input schema (the runtime turns it into the model's `function.parameters`).
   - READ tool: call the getter/`exportTo*`, return a compact serializable result (don't dump the whole scene if a summary suffices — watch token cost).
   - WRITE tool: build elements with `convertToExcalidrawElements(skeleton)` **before** `updateScene`, and pass `captureUpdate: CaptureUpdateAction.NEVER` so assistant edits stay off the user's undo stack (unless the user should be able to undo them).
4. **Handle the handle being absent.** The API is null until `<Excalidraw>` mounts — the tool must fail gracefully (return an error result, never throw) if called before then.
5. **Test it.** Mirror the existing runtime tests (`packages/app/app-browser/tests/mcp-tool.test.ts`, `tool-calling.test.ts`). Cover: happy path, API-not-ready, and (WRITE) that `convertToExcalidrawElements` is applied.
6. **Check the bundle.** Run the widget tests; `bundle-size.test.ts` must stay green (Excalidraw stays in its own lazy chunk).

## Done when

The assistant can invoke the new tool, it reads/writes the canvas correctly, it degrades gracefully when the canvas isn't mounted, tests cover it, and the bundle budget holds.
