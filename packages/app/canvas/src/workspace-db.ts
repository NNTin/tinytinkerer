import { createWorkspaceStore, type WorkspaceStore } from '@tinytinkerer/app-shell'
import { excalidrawSnapshotSchema, type ExcalidrawSnapshot } from './inputs'

export const CANVAS_DATABASE_NAME = 'tinytinkerer-canvas'
export const LEGACY_CANVAS_STORAGE_KEY = 'tinytinkerer:canvas-scene:v1'

export type CanvasWorkspaceRecord = {
  id: 'default'
  snapshot: ExcalidrawSnapshot
  updatedAt: string
}

export const canvasWorkspaceStore =
  createWorkspaceStore<CanvasWorkspaceRecord>(CANVAS_DATABASE_NAME)

const readLegacySnapshot = (storage: Storage | undefined): ExcalidrawSnapshot | null => {
  if (!storage) return null
  let value: string | null
  try {
    value = storage.getItem(LEGACY_CANVAS_STORAGE_KEY)
  } catch {
    return null
  }
  if (!value) return null
  try {
    const result = excalidrawSnapshotSchema.safeParse(JSON.parse(value))
    if (result.success) return result.data
  } catch {
    // Invalid legacy data is discarded below so it does not fail every startup.
  }
  try {
    storage.removeItem(LEGACY_CANVAS_STORAGE_KEY)
  } catch {
    // Web Storage is an optional migration source.
  }
  return null
}

const browserStorage = (): Storage | undefined => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

// Load the IndexedDB workspace first. On the first integrated-stage startup, migrate
// the previous harness localStorage snapshot. The old key is removed only after the
// IndexedDB write succeeds, so quota/availability failures never destroy user data.
export const loadCanvasSnapshot = async (
  store: WorkspaceStore<CanvasWorkspaceRecord> = canvasWorkspaceStore,
  storage: Storage | undefined = browserStorage()
): Promise<ExcalidrawSnapshot | null> => {
  const saved = await store.load()
  const parsedSaved = excalidrawSnapshotSchema.safeParse(saved?.snapshot)
  if (parsedSaved.success) return parsedSaved.data

  const legacy = readLegacySnapshot(storage)
  if (!legacy) return null
  try {
    await store.save({ id: 'default', snapshot: legacy, updatedAt: new Date().toISOString() })
    try {
      storage?.removeItem(LEGACY_CANVAS_STORAGE_KEY)
    } catch {
      // The migration has succeeded; failure to clean up the old key is harmless.
    }
  } catch {
    // Render the valid legacy snapshot even when IndexedDB is unavailable. Keeping
    // the key lets a later startup retry the migration.
  }
  return legacy
}

export const saveCanvasSnapshot = (
  snapshot: ExcalidrawSnapshot,
  store: WorkspaceStore<CanvasWorkspaceRecord> = canvasWorkspaceStore
): Promise<void> => store.save({ id: 'default', snapshot, updatedAt: new Date().toISOString() })
