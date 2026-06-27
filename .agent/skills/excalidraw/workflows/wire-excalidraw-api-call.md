# Wire a new Excalidraw API call into the canvas app

SOP for exposing one Excalidraw `excalidrawAPI` capability to the chat assistant (the chat ⇄ canvas bridge) in `apps/canvas`. Excalidraw is already embedded and its handle is held in `apps/canvas/src/canvas-bridge.ts`. Use this once per capability (one READ or one WRITE call at a time — ship READ before WRITE).

## Precondition (already satisfied in `apps/canvas`)

`apps/canvas` already: lazy-mounts `<Excalidraw>` (`features/canvas/excalidraw-canvas.tsx`, in its own `excalidraw-vendor` chunk), imports `@excalidraw/excalidraw/index.css`, captures the handle via `excalidrawAPI={(api) => setCanvasApi(api)}` (no `ref` — removed in v0.17), and gives the container full size. If you are embedding Excalidraw in a NEW shell instead, replicate those four steps first.

## Steps for one API call

1. **Confirm the contract in the reference.** `node .agent/skills/excalidraw/tools/excalidraw-ref.mjs <callName>`, then read the cited `dev-docs` file. Copy the exact signature and argument/return shapes — do not invent fields.
2. **Classify READ vs WRITE** using the API map in `../SKILL.md`. This decides the tool's risk and shape.
3. **Define the tool** in `apps/canvas/src/canvas-tools.ts`, next to the existing `draw_on_canvas` / `read_canvas` / `clear_canvas`. It is a `Tool<Input, Output>` (type re-exported from `@tinytinkerer/app-browser`) that closes over `getCanvasApi()`. These are **app-local tools**, registered via `createBrowserShellRoot`'s `appTools` seam — NOT a plugin and NOT MCP. Add it to the array `createCanvasTools()` returns.
   - Give it a tight Zod `schema` (the runtime derives the model's `function.parameters` from it).
   - **Dynamic-`import('@excalidraw/excalidraw')` inside `execute`** for any runtime value you need (`convertToExcalidrawElements`, `CaptureUpdateAction`) — never a top-level import, or Excalidraw leaks into the entry chunk.
   - READ tool: call the getter, return a compact serializable result (cap the element count — watch token cost).
   - WRITE tool: build elements with `convertToExcalidrawElements(skeleton)` **before** `updateScene`. Use `captureUpdate: CaptureUpdateAction.IMMEDIATELY` so the user can undo assistant edits (the canvas app treats the assistant as a collaborator); use `NEVER` only for edits that should bypass the undo stack.
4. **Handle the handle being absent.** `getCanvasApi()` is null until `<ExcalidrawCanvas>` mounts — return a graceful error result, never throw.
5. **Test it** in `apps/canvas/src/canvas-tools.test.ts`: mock `@excalidraw/excalidraw`, drive a fake API via `setCanvasApi`. Cover happy path, API-not-ready, and (WRITE) that `convertToExcalidrawElements` is applied. If you touched the seam, also extend `packages/app/app-browser/tests/create-runtime-plugins.test.ts`.
6. **Check the bundle.** `apps/canvas/src/bundle-size.test.ts` must stay green (Excalidraw stays in its own lazy `excalidraw-vendor` chunk).

## Done when

The assistant can invoke the new tool, it reads/writes the canvas correctly, it degrades gracefully when the canvas isn't mounted, tests cover it, and the bundle budget holds.
