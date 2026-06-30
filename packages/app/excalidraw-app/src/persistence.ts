import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_SNAPSHOT_VERSION } from '@tinytinkerer/excalidraw-protocol'
import type { ExcalidrawSnapshot } from '@tinytinkerer/excalidraw-protocol'

// Excalidraw `onChange` fires on every pointer move during a drag, so serialize and
// ship at most one snapshot per quiet window rather than on every micro-edit.
const SNAPSHOT_DEBOUNCE_MS = 600

// appState carries volatile, non-restorable UI state (selection, editing ids,
// collaborators, cursor). Persist only the view/scene fields that make a reload land
// where the user left off; everything else resets cleanly. All of these are plain,
// JSON-serializable values.
const PERSISTED_APP_STATE_KEYS = [
  'scrollX',
  'scrollY',
  'zoom',
  'viewBackgroundColor',
  'theme'
] as const

// Snapshot the live scene: non-deleted elements plus the curated view state. The app
// owns this serialization (the harness only persists the opaque result).
export const serializeScene = (api: ExcalidrawImperativeAPI): ExcalidrawSnapshot => {
  const appState = api.getAppState() as unknown as Record<string, unknown>
  const persistedAppState: Record<string, unknown> = {}
  for (const key of PERSISTED_APP_STATE_KEYS) {
    if (appState[key] !== undefined) persistedAppState[key] = appState[key]
  }
  return {
    version: EXCALIDRAW_SNAPSHOT_VERSION,
    elements: api.getSceneElements() as unknown as ExcalidrawSnapshot['elements'],
    appState: persistedAppState
  }
}

type UpdateSceneInput = Parameters<ExcalidrawImperativeAPI['updateScene']>[0]

// Apply a validated snapshot to the canvas on reload. The snapshot is already
// version-guarded by the wire contract, so a malformed/old payload never reaches
// here — it is rejected at the bridge and the canvas stays empty (fails safe).
export const applySnapshot = (
  api: ExcalidrawImperativeAPI,
  snapshot: ExcalidrawSnapshot
): { ok: true; restored: number } => {
  api.updateScene({
    elements: snapshot.elements as unknown as UpdateSceneInput['elements'],
    ...(snapshot.appState
      ? { appState: snapshot.appState as unknown as UpdateSceneInput['appState'] }
      : {}),
    // Hydration, not a user action — keep the restore out of the undo history.
    captureUpdate: CaptureUpdateAction.NEVER
  })
  return { ok: true, restored: snapshot.elements.length }
}

// Subscribe to scene changes and ship a debounced snapshot to `emit`. Returns an
// unsubscribe that also cancels any pending debounced write.
export const subscribeScenePersistence = (
  api: ExcalidrawImperativeAPI,
  emit: (snapshot: ExcalidrawSnapshot) => void
): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribe = api.onChange(() => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      emit(serializeScene(api))
    }, SNAPSHOT_DEBOUNCE_MS)
  })
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    unsubscribe()
  }
}
