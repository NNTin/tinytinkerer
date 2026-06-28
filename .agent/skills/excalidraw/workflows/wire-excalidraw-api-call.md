# Wire an Excalidraw API call through the iframe bridge

1. Confirm the exact imperative API signature with
   `node .agent/skills/excalidraw/tools/excalidraw-ref.mjs <callName>`.
2. Define or extend the input and result schemas in
   `packages/shared/excalidraw-protocol`; keep it model-friendly and serializable.
3. Bind the contract with `defineBridgeVerb` in
   `packages/app/excalidraw-app/src/bridge.ts`. The bridge validates before and after app
   code; cap READ output and use
   `CaptureUpdateAction.IMMEDIATELY` for undoable WRITE operations.
4. Declare the verb description in `apps/canvas/src/canvas-runtime.ts`. Do not
   import Excalidraw into the shell.
5. Test the schema, handler behavior, and bridge forwarding. Run both app bundle
   tests and confirm no Excalidraw module enters canvas/web/widget/mobile.
