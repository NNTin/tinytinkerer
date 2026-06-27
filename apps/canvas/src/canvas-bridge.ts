import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

// The app-local bridge between the live Excalidraw canvas and the chat tools, in
// the spirit of app-browser's human-prompt-bridge: a module singleton that the
// mounted canvas component writes and the always-on canvas tools read. Because
// the canvas and the chat overlay share one React tree, this is just a plain
// holder — no store/subscription is needed (the tools read on demand at execute
// time, the model never polls).
//
// The handle is null until <ExcalidrawCanvas> mounts and registers it via the
// `excalidrawAPI` prop, and again after it unmounts; every tool must degrade
// gracefully in that window rather than throw.

let currentApi: ExcalidrawImperativeAPI | null = null

export const setCanvasApi = (api: ExcalidrawImperativeAPI | null): void => {
  currentApi = api
}

export const getCanvasApi = (): ExcalidrawImperativeAPI | null => currentApi
