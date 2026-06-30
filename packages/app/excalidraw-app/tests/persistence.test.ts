import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { applySnapshot, createScenePersistence, serializeScene } from '../src/persistence'

vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { IMMEDIATELY: 'immediately', NEVER: 'never' }
}))

const fakeApi = (
  elements: unknown[] = [],
  state: Record<string, unknown> = {}
): ExcalidrawImperativeAPI & { emitChange: () => void } => {
  let onChangeCb: (() => void) | undefined
  return {
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => ({
      scrollX: 10,
      scrollY: -5,
      zoom: { value: 0.75 },
      viewBackgroundColor: '#fff',
      theme: 'light',
      // Volatile fields that must NOT be persisted.
      selectedElementIds: { a: true },
      editingGroupId: 'g',
      collaborators: new Map(),
      ...state
    })),
    updateScene: vi.fn(),
    updateLibrary: vi.fn(),
    onChange: vi.fn((cb: () => void) => {
      onChangeCb = cb
      return () => {
        onChangeCb = undefined
      }
    }),
    emitChange: () => onChangeCb?.()
  } as unknown as ExcalidrawImperativeAPI & { emitChange: () => void }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('excalidraw scene persistence', () => {
  it('serializes live elements and only curated view state', () => {
    const snapshot = serializeScene(fakeApi([{ id: 'a' }, { id: 'b' }]))
    expect(snapshot).toEqual({
      version: 1,
      elements: [{ id: 'a' }, { id: 'b' }],
      appState: {
        scrollX: 10,
        scrollY: -5,
        zoom: { value: 0.75 },
        viewBackgroundColor: '#fff',
        theme: 'light'
      }
    })
    expect(snapshot.appState).not.toHaveProperty('selectedElementIds')
    expect(snapshot.appState).not.toHaveProperty('collaborators')
    expect(snapshot).not.toHaveProperty('libraryItems')
  })

  it('includes imported library items when present', () => {
    const snapshot = serializeScene(fakeApi([{ id: 'a' }]), () => [{ id: 'lib-1' }])
    expect(snapshot.libraryItems).toEqual([{ id: 'lib-1' }])
    // An empty library is omitted entirely.
    expect(serializeScene(fakeApi(), () => [])).not.toHaveProperty('libraryItems')
  })

  it('applies a snapshot without polluting the undo history', () => {
    const api = fakeApi()
    const result = applySnapshot(api, {
      version: 1,
      elements: [{ id: 'a' }, { id: 'b' }],
      appState: { scrollX: 1 }
    })
    expect(result).toEqual({ ok: true, restored: 2 })
    expect(api.updateScene).toHaveBeenCalledWith({
      elements: [{ id: 'a' }, { id: 'b' }],
      appState: { scrollX: 1 },
      captureUpdate: 'never'
    })
    expect(api.updateLibrary).not.toHaveBeenCalled()
  })

  it('restores persisted library items on apply', () => {
    const api = fakeApi()
    applySnapshot(api, {
      version: 1,
      elements: [],
      libraryItems: [{ id: 'lib-1' }, { id: 'lib-2' }]
    })
    expect(api.updateLibrary).toHaveBeenCalledWith({
      libraryItems: [{ id: 'lib-1' }, { id: 'lib-2' }],
      merge: false
    })
  })

  it('emits at most one debounced snapshot per quiet window', () => {
    const api = fakeApi([{ id: 'a' }])
    const emit = vi.fn()
    const persistence = createScenePersistence(api, emit)

    api.emitChange()
    api.emitChange()
    api.emitChange()
    expect(emit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(600)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }))

    persistence.dispose()
    api.emitChange()
    vi.advanceTimersByTime(600)
    // No further emits after dispose.
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('save() can be triggered directly (e.g. on a library change)', () => {
    const api = fakeApi([{ id: 'a' }])
    const emit = vi.fn()
    const persistence = createScenePersistence(api, emit, () => [{ id: 'lib-1' }])
    persistence.save()
    vi.advanceTimersByTime(600)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ libraryItems: [{ id: 'lib-1' }] }))
    persistence.dispose()
  })

  it('cancels a pending debounced write on dispose', () => {
    const api = fakeApi()
    const emit = vi.fn()
    const persistence = createScenePersistence(api, emit)
    api.emitChange()
    persistence.dispose()
    vi.advanceTimersByTime(600)
    expect(emit).not.toHaveBeenCalled()
  })
})
