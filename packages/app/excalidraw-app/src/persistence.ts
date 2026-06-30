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

// Latest imported library items, if any, sourced from the app's `onLibraryChange`
// (the imperative API has no library getter). Library changes are tracked separately
// from the scene so an imported library survives a reload alongside the drawing.
export type LibraryItemsGetter = () => readonly unknown[]

// Snapshot the live scene: non-deleted elements plus the curated view state, and any
// imported library items. The app owns this serialization (the harness only persists
// the opaque result).
export const serializeScene = (
  api: ExcalidrawImperativeAPI,
  getLibraryItems?: LibraryItemsGetter
): ExcalidrawSnapshot => {
  const appState = api.getAppState() as unknown as Record<string, unknown>
  const persistedAppState: Record<string, unknown> = {}
  for (const key of PERSISTED_APP_STATE_KEYS) {
    if (appState[key] !== undefined) persistedAppState[key] = appState[key]
  }
  const libraryItems = getLibraryItems?.()
  return {
    version: EXCALIDRAW_SNAPSHOT_VERSION,
    elements: api.getSceneElements() as unknown as ExcalidrawSnapshot['elements'],
    appState: persistedAppState,
    ...(libraryItems && libraryItems.length > 0
      ? { libraryItems: libraryItems as unknown as ExcalidrawSnapshot['libraryItems'] }
      : {})
  }
}

type UpdateSceneInput = Parameters<ExcalidrawImperativeAPI['updateScene']>[0]
type UpdateLibraryInput = Parameters<ExcalidrawImperativeAPI['updateLibrary']>[0]

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
  if (snapshot.libraryItems && snapshot.libraryItems.length > 0) {
    // Library has its own store; replace it with the persisted set (fire-and-forget).
    void api.updateLibrary({
      libraryItems: snapshot.libraryItems as unknown as UpdateLibraryInput['libraryItems'],
      merge: false
    })
  }
  return { ok: true, restored: snapshot.elements.length }
}

// A debounced scene snapshotter. `save()` schedules a snapshot to `emit`; it is wired
// to Excalidraw's `onChange` here and should also be called on `onLibraryChange` (which
// is a render prop, not an API subscription). `dispose()` cancels any pending write and
// unsubscribes.
export const createScenePersistence = (
  api: ExcalidrawImperativeAPI,
  emit: (snapshot: ExcalidrawSnapshot) => void,
  getLibraryItems?: LibraryItemsGetter
): { save: () => void; dispose: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      emit(serializeScene(api, getLibraryItems))
    }, SNAPSHOT_DEBOUNCE_MS)
  }
  const unsubscribe = api.onChange(save)
  return {
    save,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
    }
  }
}
