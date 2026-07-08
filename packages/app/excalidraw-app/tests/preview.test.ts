import { describe, expect, it, vi } from 'vitest'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import { createExcalidrawHandlers } from '../src/bridge'

// preview dispatches into the REAL executors (create/edit/structure/binding/
// layout/presets), so this mock has to cover everything those modules import
// from '@excalidraw/excalidraw' — mirrors bridge.test.ts's/structure.test.ts's
// mock exactly.
vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  convertToExcalidrawElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element, index) => {
      const text = typeof element.text === 'string' ? element.text : ''
      return element.type === 'text'
        ? {
            id: `converted-${index}`,
            ...element,
            type: 'text',
            text,
            originalText: text,
            width: text.length * 10,
            height: 20
          }
        : { id: `converted-${index}`, ...element }
    }),
  getCommonBounds: (elements: Array<{ x: number; y: number; width: number; height: number }>) => {
    const x1 = Math.min(...elements.map((element) => element.x))
    const y1 = Math.min(...elements.map((element) => element.y))
    const x2 = Math.max(...elements.map((element) => element.x + element.width))
    const y2 = Math.max(...elements.map((element) => element.y + element.height))
    return [x1, y1, x2, y2]
  },
  getVisibleSceneBounds: () => [0, 0, 400, 300],
  hashElementsVersion: (elements: Array<{ version: number }>) =>
    elements.reduce((version, element) => version + element.version, 0),
  newElementWith: (
    element: Record<string, unknown> & { version: number },
    updates: Record<string, unknown>
  ) => {
    const changed = Object.entries(updates).some(
      ([key, value]) => JSON.stringify(element[key]) !== JSON.stringify(value)
    )
    return changed ? { ...element, ...updates, version: element.version + 1 } : element
  }
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

const text = (
  id: string,
  content: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> =>
  rect(id, {
    type: 'text',
    text: content,
    originalText: content,
    fontSize: 20,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    width: content.length * 10,
    height: 20,
    ...overrides
  })

const arrow = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> =>
  rect(id, {
    type: 'arrow',
    width: 100,
    height: 0,
    points: [
      [0, 0],
      [100, 0]
    ],
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    ...overrides
  })

// Mirrors the mocked hashElementsVersion: the scene version is the sum of
// element versions.
const sceneVersion = (elements: Array<Record<string, unknown>>): number =>
  elements.reduce((sum, element) => sum + (element.version as number), 0)

const refs = (
  elements: Array<Record<string, unknown>>,
  ids: string[]
): Array<{ id: string; expectedVersion: number }> =>
  ids.map((id) => {
    const element = elements.find((candidate) => candidate.id === id)!
    return { id, expectedVersion: element.version as number }
  })

const fakeApi = (
  elements: unknown[] = [],
  state: Record<string, unknown> = {}
): ExcalidrawImperativeAPI =>
  ({
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => ({
      selectedElementIds: {},
      selectedGroupIds: {},
      editingGroupId: null,
      ...state
    })),
    updateScene: vi.fn(),
    scrollToContent: vi.fn()
  }) as unknown as ExcalidrawImperativeAPI

// A fake api whose `getSceneElements` reflects whatever the last real
// `updateScene` committed — needed for the apply-after-preview test, which
// checks a real apply against one api instance actually changes what a
// following preview sees. The plain `fakeApi` above is a static snapshot and
// deliberately doesn't do this (every other test only inspects a single
// updateScene call's arguments).
const statefulApi = (initial: unknown[]): ExcalidrawImperativeAPI => {
  let scene = initial
  return {
    getSceneElements: vi.fn(() => scene),
    getAppState: vi.fn(() => ({
      selectedElementIds: {},
      selectedGroupIds: {},
      editingGroupId: null
    })),
    updateScene: vi.fn((sceneData: { elements?: unknown[] }) => {
      if (sceneData.elements) scene = sceneData.elements
    }),
    scrollToContent: vi.fn()
  } as unknown as ExcalidrawImperativeAPI
}

type PreviewResult = {
  ok: true
  verb: string
  wouldChange: boolean
  sceneVersion: number
  summary: { adds: number; updates: number; deletes: number; total: number }
  changes: Array<{ op: string; id: string; type: string; label?: string; version?: number }>
  truncation: { truncated: boolean; fields: string[]; omittedElements: number }
}

const run = (api: ExcalidrawImperativeAPI, payload: unknown): Promise<PreviewResult> => {
  const registration = createExcalidrawHandlers(api).preview
  if (!registration || typeof registration === 'function')
    throw new Error('Missing schema-bound handler: preview')
  const input = registration.inputSchema.parse(payload)
  return Promise.resolve()
    .then(() => registration.handler(input))
    .then((result) => registration.resultSchema.parse(result)) as Promise<PreviewResult>
}

const runVerb = (
  api: ExcalidrawImperativeAPI,
  verb: string,
  payload: unknown
): Promise<unknown> => {
  const registration = createExcalidrawHandlers(api)[verb]
  if (!registration || typeof registration === 'function')
    throw new Error(`Missing schema-bound handler: ${verb}`)
  const input = registration.inputSchema.parse(payload)
  return Promise.resolve()
    .then(() => registration.handler(input))
    .then((result) => registration.resultSchema.parse(result))
}

describe('preview: does not mutate', () => {
  it('never calls the real updateScene/scrollToContent and leaves the scene untouched', async () => {
    const elements = [rect('a', { version: 3 }), rect('b', { x: 200, version: 1 })]
    const api = fakeApi(elements)

    const result = await run(api, {
      verb: 'edit',
      input: { edits: [{ id: 'a', expectedVersion: 3, changes: { x: 50 } }] }
    })

    expect(result.wouldChange).toBe(true)
    expect(api.updateScene).not.toHaveBeenCalled()
    expect(api.scrollToContent).not.toHaveBeenCalled()
    // The original scene objects are untouched — preview never wrote through.
    expect(elements[0]).toMatchObject({ id: 'a', x: 0, version: 3 })
  })
})

describe('preview: patch summaries per verb', () => {
  it('summarizes an edit as an update with the label and prior version', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box' })
    const elements = [container, label]
    const api = fakeApi(elements)

    const result = await run(api, {
      verb: 'edit',
      input: {
        edits: [{ id: 'box', expectedVersion: 1, changes: { strokeColor: '#ffc9c9' } }]
      }
    })

    expect(result).toMatchObject({
      wouldChange: true,
      sceneVersion: sceneVersion(elements),
      summary: { adds: 0, updates: 1, deletes: 0, total: 1 }
    })
    expect(result.changes).toEqual([
      { op: 'update', id: 'box', type: 'rectangle', label: 'Box', version: 1 }
    ])
  })

  it('counts a draw as adds and does not scroll to the new content', async () => {
    const api = fakeApi([])

    const result = await run(api, {
      verb: 'draw',
      input: { elements: [{ type: 'rectangle', x: 0, y: 0, text: 'Router' }] }
    })

    expect(result.summary).toMatchObject({ adds: 1, updates: 0, deletes: 0, total: 1 })
    expect(result.wouldChange).toBe(true)
    expect(result.changes[0]).toMatchObject({ op: 'add', type: 'rectangle' })
    expect(api.scrollToContent).not.toHaveBeenCalled()
  })

  it('counts a related delete as deletes plus a detached-survivor update', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box' })
    const link = arrow('link', { startBinding: { elementId: 'box', focus: 0, gap: 4 } })
    const elements = [container, label, link]
    const api = fakeApi(elements)

    const result = await run(api, {
      verb: 'delete',
      input: {
        elements: refs(elements, ['box']),
        includeRelated: true,
        expectedSceneVersion: sceneVersion(elements)
      }
    })

    expect(result.summary).toMatchObject({ adds: 0, updates: 1, deletes: 2, total: 3 })
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'delete', id: 'box' }),
        expect.objectContaining({ op: 'delete', id: 'label' }),
        expect.objectContaining({ op: 'update', id: 'link' })
      ])
    )
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('reports a pure z-reorder as updates even though no element content changes', async () => {
    const elements = [rect('a'), rect('b', { x: 200 }), rect('c', { x: 400 })]
    const api = fakeApi(elements)

    const result = await run(api, {
      verb: 'order',
      input: {
        elements: refs(elements, ['a']),
        operation: 'front',
        expectedSceneVersion: sceneVersion(elements)
      }
    })

    // [a,b,c] → [b,c,a]: the objects are untouched (same identity), but every
    // element's z-index changed — an identity-only diff would report nothing.
    expect(result.summary).toMatchObject({ adds: 0, updates: 3, deletes: 0, total: 3 })
    expect(result.wouldChange).toBe(true)
    expect(result.changes.map((change) => change.id)).toEqual(['b', 'c', 'a'])
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('summarizes clear as deleting every element', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const api = fakeApi(elements)

    const result = await run(api, { verb: 'clear', input: {} })

    expect(result.summary).toMatchObject({ adds: 0, updates: 0, deletes: 2, total: 2 })
    expect(result.wouldChange).toBe(true)
    expect(result.changes.map((change) => change.id).sort()).toEqual(['a', 'b'])
  })
})

describe('preview: validation', () => {
  it("rejects a stale expectedVersion with the executor's own message, changing nothing", async () => {
    const elements = [rect('a', { version: 5 })]
    const api = fakeApi(elements)

    await expect(
      run(api, {
        verb: 'align',
        input: {
          elements: [{ id: 'a', expectedVersion: 1 }],
          axis: 'x',
          position: 'start',
          expectedSceneVersion: sceneVersion(elements)
        }
      })
    ).rejects.toThrow('stale')
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('names the verb when the nested input fails validation', async () => {
    const api = fakeApi([])
    await expect(run(api, { verb: 'edit', input: { edits: [] } })).rejects.toThrow(
      'preview: invalid input for verb "edit"'
    )
  })
})

describe('preview: apply-after-preview', () => {
  it('lets the real verb apply after a successful preview, then rejects a repeat preview as stale', async () => {
    const elements = [rect('a', { x: 0, version: 1 }), rect('b', { x: 200, version: 1 })]
    const api = statefulApi(elements)
    const payload = {
      elements: refs(elements, ['a', 'b']),
      axis: 'x',
      position: 'start',
      expectedSceneVersion: sceneVersion(elements)
    }

    const previewed = await run(api, { verb: 'align', input: payload })
    expect(previewed.wouldChange).toBe(true)
    expect(api.updateScene).not.toHaveBeenCalled()

    await runVerb(api, 'align', payload)
    expect(api.updateScene).toHaveBeenCalledTimes(1)

    // The applied align bumped b's version and the scene version, so the same
    // (now-stale) payload is rejected instead of silently re-diffing.
    await expect(run(api, { verb: 'align', input: payload })).rejects.toThrow(/scene changed/)
  })
})

describe('preview: budget trimming', () => {
  it('drops trailing changes past the byte budget but keeps the full summary counts', async () => {
    // A single new element with a huge id blows the 32KB result budget on its
    // own; trimToBudget drops it to an empty `changes` array while the summary
    // (computed from the full diff) still reports the real count.
    const hugeId = 'x'.repeat(40_000)
    const api = fakeApi([])

    const result = await run(api, {
      verb: 'draw',
      input: { elements: [{ id: hugeId, type: 'rectangle', x: 0, y: 0 }] }
    })

    expect(result.summary).toMatchObject({ adds: 1, updates: 0, deletes: 0, total: 1 })
    expect(result.changes).toHaveLength(0)
    expect(result.truncation.truncated).toBe(true)
    expect(result.truncation.omittedElements).toBe(1)
    const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength
    expect(bytes).toBeLessThanOrEqual(EXCALIDRAW_PAYLOAD_BUDGETS.preview.result)
  })
})
