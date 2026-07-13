import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { PickInput } from '../src/inputs'
import { executePick, PICK_SETTLE_MS } from '../src/pick'

// pick doesn't import '@excalidraw/excalidraw' directly, but its dependencies
// (normalization.ts's sceneVersionOf) do — same sum-of-versions convention as
// the rest of this suite.
vi.mock('@excalidraw/excalidraw', () => ({
  hashElementsVersion: (elements: Array<{ version: number }>) =>
    elements.reduce((version, element) => version + element.version, 0)
}))

const rect = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  angle: 0,
  strokeColor: '#1b1b1f',
  backgroundColor: 'transparent',
  fillStyle: 'hachure',
  strokeWidth: 1,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  seed: 1,
  version: 1,
  versionNonce: 2,
  index: 'a0',
  isDeleted: false,
  groupIds: [],
  frameId: null,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
  ...overrides
})

type AppStateShape = {
  selectedElementIds: Record<string, boolean>
  selectedGroupIds: Record<string, boolean>
  editingGroupId: string | null
}
type OnChangeCallback = (elements: unknown[], appState: AppStateShape) => void

// A stateful fake: `emitSelection` simulates a live selection change firing
// every subscribed `onChange` callback, exactly like the real component would
// after a user click/marquee updates `selectedElementIds`.
const fakeApi = (
  elements: unknown[],
  initialSelection: Record<string, boolean> = {}
): { api: ExcalidrawImperativeAPI; emitSelection: (selected: Record<string, boolean>) => void } => {
  let state: AppStateShape = {
    selectedElementIds: initialSelection,
    selectedGroupIds: {},
    editingGroupId: null
  }
  const subscribers = new Set<OnChangeCallback>()
  const api = {
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => state),
    onChange: vi.fn((callback: OnChangeCallback) => {
      subscribers.add(callback)
      return () => subscribers.delete(callback)
    }),
    setToast: vi.fn()
  } as unknown as ExcalidrawImperativeAPI
  const emitSelection = (selected: Record<string, boolean>): void => {
    state = { ...state, selectedElementIds: selected }
    for (const callback of subscribers) callback(elements, state)
  }
  return { api, emitSelection }
}

const input = (overrides: Partial<PickInput> = {}): PickInput => ({
  mode: 'current',
  timeoutSeconds: 60,
  detail: 'standard',
  ...overrides
})

describe('pick: current mode', () => {
  it('returns the live selection and drops deleted/stale selection ids', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const { api } = fakeApi(elements, { a: true, ghost: true })

    const result = await executePick(api, input({ mode: 'current' }))

    expect(result.timedOut).toBe(false)
    expect(result.selectedCount).toBe(1)
    expect(result.selection.elementIds).toEqual(['a'])
    expect(result.elements.map((element) => element.id)).toEqual(['a'])
  })
})

describe('pick: fields projection', () => {
  it('projects each element down to id/type/kind plus the requested fields', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const { api } = fakeApi(elements, { a: true, b: true })

    const result = await executePick(
      api,
      input({ mode: 'current', fields: ['x', 'y', 'width', 'height'] })
    )

    expect(result.fields).toEqual(['x', 'y', 'width', 'height'])
    for (const element of result.elements) {
      expect(Object.keys(element).sort()).toEqual(
        ['height', 'id', 'kind', 'type', 'width', 'x', 'y'].sort()
      )
    }
    expect(result.elements[0]).not.toHaveProperty('style')
    expect(result.elements[0]).not.toHaveProperty('capabilities')
  })

  it('leaves unfiltered records full and omits fields from the result', async () => {
    const elements = [rect('a')]
    const { api } = fakeApi(elements, { a: true })

    const result = await executePick(api, input({ mode: 'current' }))

    expect(result).not.toHaveProperty('fields')
    expect(result.elements[0]).toHaveProperty('style')
    expect(result.elements[0]).toHaveProperty('capabilities')
  })

  it('fits a ~10-element selection fully when filtered, though the unfiltered result truncates it', async () => {
    // Each element's link is under the per-field 8,192-byte cap (so no single
    // field is truncated) but ten of them together blow the 64 KiB pick budget,
    // so the unfiltered result drops trailing elements. Projecting away `link`
    // shrinks every record enough that all ten fit.
    const elements = Array.from({ length: 10 }, (_, index) =>
      rect(`heavy-${index}`, { link: 'x'.repeat(8_000) })
    )
    const selection = Object.fromEntries(elements.map((element) => [String(element.id), true]))
    const { api } = fakeApi(elements, selection)

    const unfiltered = await executePick(api, input({ mode: 'current' }))
    expect(unfiltered.truncation.omittedElements).toBeGreaterThan(0)

    const filtered = await executePick(
      api,
      input({ mode: 'current', fields: ['x', 'y', 'width', 'height'] })
    )
    expect(filtered.truncation.omittedElements).toBe(0)
    expect(filtered.elements).toHaveLength(10)
  })
})

describe('pick: interactive mode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a toast, then resolves after a selection settles for PICK_SETTLE_MS', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const { api, emitSelection } = fakeApi(elements)

    const promise = executePick(
      api,
      input({ mode: 'interactive', prompt: 'Pick one', timeoutSeconds: 60 })
    )
    expect(api.setToast).toHaveBeenCalledWith({
      message: 'Pick one',
      closable: true,
      duration: 60_000
    })

    emitSelection({ a: true })
    vi.advanceTimersByTime(PICK_SETTLE_MS - 1)
    let settled = false
    void promise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    vi.advanceTimersByTime(1)
    const result = await promise
    expect(result.timedOut).toBe(false)
    expect(result.selection.elementIds).toEqual(['a'])
    expect(api.setToast).toHaveBeenLastCalledWith(null)
  })

  it('restarts the settle timer on selection churn', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const { api, emitSelection } = fakeApi(elements)

    const promise = executePick(api, input({ mode: 'interactive' }))
    let settled = false
    void promise.then(() => {
      settled = true
    })

    emitSelection({ a: true })
    vi.advanceTimersByTime(PICK_SETTLE_MS - 100)
    emitSelection({ b: true }) // churn: restarts the settle window
    vi.advanceTimersByTime(PICK_SETTLE_MS - 100)
    await Promise.resolve()
    expect(settled).toBe(false)

    vi.advanceTimersByTime(100)
    const result = await promise
    expect(result.selection.elementIds).toEqual(['b'])
  })

  it('ignores an empty selection instead of settling on it', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const { api, emitSelection } = fakeApi(elements)

    const promise = executePick(api, input({ mode: 'interactive', timeoutSeconds: 5 }))
    let settled = false
    void promise.then(() => {
      settled = true
    })

    emitSelection({ a: true })
    vi.advanceTimersByTime(PICK_SETTLE_MS / 2)
    emitSelection({}) // clears back to empty — must not settle on this
    vi.advanceTimersByTime(PICK_SETTLE_MS)
    await Promise.resolve()
    expect(settled).toBe(false)

    vi.advanceTimersByTime(5_000)
    const result = await promise
    expect(result.timedOut).toBe(true)
  })

  it('times out with timedOut:true, toast cleared, and onChange unsubscribed', async () => {
    const elements = [rect('a')]
    const { api } = fakeApi(elements)

    const promise = executePick(api, input({ mode: 'interactive', timeoutSeconds: 5 }))
    vi.advanceTimersByTime(5_000)
    const result = await promise

    expect(result.timedOut).toBe(true)
    expect(result.selectedCount).toBe(0)
    expect(api.setToast).toHaveBeenLastCalledWith(null)
  })

  it('rejects a second concurrent interactive pick', async () => {
    const elements = [rect('a')]
    const { api } = fakeApi(elements)

    const first = executePick(api, input({ mode: 'interactive', timeoutSeconds: 5 }))
    await expect(executePick(api, input({ mode: 'interactive' }))).rejects.toThrow(
      'pick: an interactive pick is already waiting for the user'
    )

    vi.advanceTimersByTime(5_000)
    await first
  })

  it('allows a new interactive pick once the previous one has settled', async () => {
    const elements = [rect('a')]
    const { api } = fakeApi(elements)

    const first = executePick(api, input({ mode: 'interactive', timeoutSeconds: 5 }))
    vi.advanceTimersByTime(5_000)
    await first

    const second = executePick(api, input({ mode: 'interactive', timeoutSeconds: 5 }))
    vi.advanceTimersByTime(5_000)
    await expect(second).resolves.toMatchObject({ timedOut: true })
  })
})
