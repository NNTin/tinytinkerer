// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceStore } from '@tinytinkerer/app-shell'
import {
  LEGACY_CANVAS_STORAGE_KEY,
  loadCanvasSnapshot,
  saveCanvasSnapshot,
  type CanvasWorkspaceRecord
} from '../src/workspace-db'

const snapshot = {
  version: 1 as const,
  elements: [{ id: 'shape-1' }],
  appState: { scrollX: 4 },
  libraryItems: [{ id: 'library-1' }]
}

type TestStore = {
  workspace: WorkspaceStore<CanvasWorkspaceRecord>
  save: ReturnType<typeof vi.fn<(record: CanvasWorkspaceRecord) => Promise<void>>>
}

const store = (
  saved: CanvasWorkspaceRecord | null = null,
  save = vi.fn<(record: CanvasWorkspaceRecord) => Promise<void>>().mockResolvedValue(undefined)
): TestStore => ({
  workspace: {
    load: () => Promise.resolve(saved),
    save: (record) => save(record)
  },
  save
})

const expectSavedSnapshot = (save: TestStore['save']): void => {
  const record = save.mock.calls[0]?.[0]
  expect(record).toMatchObject({ id: 'default', snapshot })
  expect(Number.isNaN(Date.parse(record?.updatedAt ?? ''))).toBe(false)
}

beforeEach(() => window.localStorage.clear())

describe('canvas workspace persistence', () => {
  it('loads the validated IndexedDB record before considering legacy storage', async () => {
    window.localStorage.setItem(
      LEGACY_CANVAS_STORAGE_KEY,
      JSON.stringify({ ...snapshot, elements: [] })
    )
    const testStore = store({
      id: 'default',
      snapshot,
      updatedAt: '2026-07-13T00:00:00.000Z'
    })

    await expect(loadCanvasSnapshot(testStore.workspace, window.localStorage)).resolves.toEqual(
      snapshot
    )
    expect(testStore.save).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(LEGACY_CANVAS_STORAGE_KEY)).not.toBeNull()
  })

  it('migrates a legacy localStorage snapshot and removes it after saving', async () => {
    window.localStorage.setItem(LEGACY_CANVAS_STORAGE_KEY, JSON.stringify(snapshot))
    const testStore = store()

    await expect(loadCanvasSnapshot(testStore.workspace, window.localStorage)).resolves.toEqual(
      snapshot
    )
    expectSavedSnapshot(testStore.save)
    expect(window.localStorage.getItem(LEGACY_CANVAS_STORAGE_KEY)).toBeNull()
  })

  it('keeps and renders valid legacy data when IndexedDB migration fails', async () => {
    window.localStorage.setItem(LEGACY_CANVAS_STORAGE_KEY, JSON.stringify(snapshot))
    const testStore = store(
      null,
      vi
        .fn<(record: CanvasWorkspaceRecord) => Promise<void>>()
        .mockRejectedValue(new Error('quota'))
    )

    await expect(loadCanvasSnapshot(testStore.workspace, window.localStorage)).resolves.toEqual(
      snapshot
    )
    expect(window.localStorage.getItem(LEGACY_CANVAS_STORAGE_KEY)).not.toBeNull()
  })

  it('discards malformed legacy data without throwing', async () => {
    window.localStorage.setItem(LEGACY_CANVAS_STORAGE_KEY, '{bad json')
    await expect(loadCanvasSnapshot(store().workspace, window.localStorage)).resolves.toBeNull()
    expect(window.localStorage.getItem(LEGACY_CANVAS_STORAGE_KEY)).toBeNull()
  })

  it('saves a complete snapshot as the default workspace', async () => {
    const testStore = store()
    await saveCanvasSnapshot(snapshot, testStore.workspace)
    expectSavedSnapshot(testStore.save)
  })
})
