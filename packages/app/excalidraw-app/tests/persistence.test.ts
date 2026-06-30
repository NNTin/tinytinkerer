import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { applySnapshot, serializeScene, subscribeScenePersistence } from '../src/persistence'

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
  })

  it('emits at most one debounced snapshot per quiet window', () => {
    const api = fakeApi([{ id: 'a' }])
    const emit = vi.fn()
    const stop = subscribeScenePersistence(api, emit)

    api.emitChange()
    api.emitChange()
    api.emitChange()
    expect(emit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(600)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }))

    stop()
    api.emitChange()
    vi.advanceTimersByTime(600)
    // No further emits after unsubscribe.
    expect(emit).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending debounced write on unsubscribe', () => {
    const api = fakeApi()
    const emit = vi.fn()
    const stop = subscribeScenePersistence(api, emit)
    api.emitChange()
    stop()
    vi.advanceTimersByTime(600)
    expect(emit).not.toHaveBeenCalled()
  })
})
