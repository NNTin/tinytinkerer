import { describe, expect, it, vi } from 'vitest'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { createExcalidrawHandlers } from '../src/bridge'

vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  getCommonBounds: (elements: Array<{ x: number; y: number; width: number; height: number }>) => {
    const x1 = Math.min(...elements.map((element) => element.x))
    const y1 = Math.min(...elements.map((element) => element.y))
    const x2 = Math.max(...elements.map((element) => element.x + element.width))
    const y2 = Math.max(...elements.map((element) => element.y + element.height))
    return [x1, y1, x2, y2]
  },
  hashElementsVersion: (elements: Array<{ version: number }>) =>
    elements.reduce((version, element) => version + element.version, 0),
  newElementWith: (
    element: Record<string, unknown> & { version: number },
    updates: Record<string, unknown>
  ) => {
    const changed = Object.entries(updates).some(([key, value]) => element[key] !== value)
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

// Mirrors the mocked hashElementsVersion: the scene version is the sum of element
// versions, so tests can compute the expectedSceneVersion their operands require.
const sceneVersion = (elements: Array<Record<string, unknown>>): number =>
  elements.reduce((sum, element) => sum + (element.version as number), 0)

// Build versioned operand refs from scene elements (defaulting expectedVersion to
// the element's current version).
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

type Verb =
  | 'group'
  | 'duplicate'
  | 'delete'
  | 'align'
  | 'distribute'
  | 'stack'
  | 'order'
  | 'transform'

const run = (api: ExcalidrawImperativeAPI, verb: Verb, payload: unknown): Promise<unknown> => {
  const registration = createExcalidrawHandlers(api)[verb]
  if (!registration || typeof registration === 'function')
    throw new Error(`Missing schema-bound handler: ${verb}`)
  const input = registration.inputSchema.parse(payload)
  return Promise.resolve()
    .then(() => registration.handler(input))
    .then((result) => registration.resultSchema.parse(result))
}

const sceneOf = (api: ExcalidrawImperativeAPI) =>
  vi.mocked(api.updateScene).mock.calls[0]?.[0]?.elements as
    | Array<Record<string, unknown>>
    | undefined

describe('structure: grouping', () => {
  it('groups two elements and carries their bound label, contiguously', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box' })
    const other = rect('other', { x: 400 })
    const elements = [container, label, other]
    const api = fakeApi(elements)

    const result = (await run(api, 'group', {
      operation: 'group',
      elements: refs(elements, ['box', 'other']),
      expectedSceneVersion: sceneVersion(elements)
    })) as {
      operation: string
      groupId: string
      updated: number
      elements: Array<{ id: string; groupIds: string[] }>
    }

    expect(result.operation).toBe('group')
    expect(result.updated).toBe(3) // box, its label, and other
    const scene = sceneOf(api)!
    const groupId = result.groupId
    expect(
      scene.filter((element) => (element.groupIds as string[]).includes(groupId))
    ).toHaveLength(3)
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    )
  })

  it('is a no-op for a single-element group request', async () => {
    const elements = [rect('box')]
    const api = fakeApi(elements)
    await expect(
      run(api, 'group', {
        operation: 'group',
        elements: refs(elements, ['box']),
        expectedSceneVersion: sceneVersion(elements)
      })
    ).resolves.toMatchObject({ operation: 'group', updated: 0, groupId: null })
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('ungroups by removing the outermost shared group', async () => {
    const a = rect('a', { groupIds: ['g1'] })
    const b = rect('b', { x: 200, groupIds: ['g1'] })
    const elements = [a, b]
    const api = fakeApi(elements)
    const result = (await run(api, 'group', {
      operation: 'ungroup',
      elements: refs(elements, ['a', 'b']),
      expectedSceneVersion: sceneVersion(elements)
    })) as { updated: number; elements: Array<{ groupIds: string[] }> }
    expect(result.updated).toBe(2)
    expect(sceneOf(api)!.every((element) => (element.groupIds as string[]).length === 0)).toBe(true)
  })

  it('groups the current selection when elements are omitted', async () => {
    const a = rect('a')
    const b = rect('b', { x: 200 })
    const api = fakeApi([a, b], { selectedElementIds: { a: true, b: true } })
    await expect(run(api, 'group', { operation: 'group' })).resolves.toMatchObject({ updated: 2 })
  })
})

describe('structure: versioning by default', () => {
  it('rejects a structural edit when an explicit element version is stale', async () => {
    const a = rect('a', { x: 0, version: 5 })
    const b = rect('b', { x: 200, version: 1 })
    const elements = [a, b]
    const api = fakeApi(elements)
    await expect(
      run(api, 'align', {
        elements: [
          { id: 'a', expectedVersion: 2 },
          { id: 'b', expectedVersion: 1 }
        ],
        axis: 'x',
        position: 'start',
        expectedSceneVersion: sceneVersion(elements)
      })
    ).rejects.toThrow('stale')
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('rejects a structural edit when the expected scene version is stale', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const api = fakeApi(elements)
    await expect(
      run(api, 'align', {
        elements: refs(elements, ['a', 'b']),
        axis: 'x',
        position: 'start',
        expectedSceneVersion: 999
      })
    ).rejects.toThrow('scene changed')
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('rejects an unknown explicit id', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const api = fakeApi(elements)
    await expect(
      run(api, 'align', {
        elements: [
          { id: 'a', expectedVersion: 1 },
          { id: 'ghost', expectedVersion: 1 }
        ],
        axis: 'x',
        position: 'start',
        expectedSceneVersion: sceneVersion(elements)
      })
    ).rejects.toThrow('does not exist')
    expect(api.updateScene).not.toHaveBeenCalled()
  })
})

describe('structure: duplicate and delete', () => {
  it('duplicates by id with an offset and fresh, remapped relationships', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box', x: 10, y: 40 })
    const elements = [container, label]
    const api = fakeApi(elements)

    const result = (await run(api, 'duplicate', {
      elements: refs(elements, ['box']),
      offset: { x: 25, y: 35 },
      expectedSceneVersion: sceneVersion(elements)
    })) as {
      created: number
      idMap: Array<{ sourceId: string; newId: string }>
      elements: Array<Record<string, unknown>>
    }

    expect(result.created).toBe(2) // box + its label
    const boxCopyId = result.idMap.find((entry) => entry.sourceId === 'box')!.newId
    const labelCopyId = result.idMap.find((entry) => entry.sourceId === 'label')!.newId
    const scene = sceneOf(api)!
    const boxCopy = scene.find((element) => element.id === boxCopyId)!
    const labelCopy = scene.find((element) => element.id === labelCopyId)!
    expect(boxCopy).toMatchObject({ x: 25, y: 35 })
    expect(labelCopy).toMatchObject({ containerId: boxCopyId })
    expect(boxCopy.boundElements).toEqual([{ id: labelCopyId, type: 'text' }])
    expect(scene).toHaveLength(4) // originals untouched + 2 copies
  })

  it('rejects duplicating an unknown id without touching the scene', async () => {
    const elements = [rect('box')]
    const api = fakeApi(elements)
    await expect(
      run(api, 'duplicate', {
        elements: [{ id: 'ghost', expectedVersion: 1 }],
        expectedSceneVersion: sceneVersion(elements)
      })
    ).rejects.toThrow('does not exist')
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('deletes a plain element by id', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const api = fakeApi(elements)
    const result = (await run(api, 'delete', {
      elements: refs(elements, ['a']),
      expectedSceneVersion: sceneVersion(elements)
    })) as { deleted: number; deletedIds: string[]; removedRelatedIds: string[] }
    expect(result).toMatchObject({ deleted: 1, deletedIds: ['a'], removedRelatedIds: [] })
    expect(sceneOf(api)!.map((element) => element.id)).toEqual(['b'])
  })

  it('rejects a relationship-crossing delete unless includeRelated is set', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box' })
    const link = arrow('link', { startBinding: { elementId: 'box', focus: 0, gap: 4 } })
    const elements = [container, label, link]
    const api = fakeApi(elements)
    await expect(
      run(api, 'delete', {
        elements: refs(elements, ['box']),
        expectedSceneVersion: sceneVersion(elements)
      })
    ).rejects.toThrow('includeRelated:true')
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('cascades bound labels and detaches connectors when includeRelated is set', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box' })
    const link = arrow('link', { startBinding: { elementId: 'box', focus: 0, gap: 4 } })
    const elements = [container, label, link]
    const api = fakeApi(elements)

    const result = (await run(api, 'delete', {
      elements: refs(elements, ['box']),
      includeRelated: true,
      expectedSceneVersion: sceneVersion(elements)
    })) as { deleted: number; deletedIds: string[]; removedRelatedIds: string[] }

    expect(result).toMatchObject({ deleted: 1, deletedIds: ['box'], removedRelatedIds: ['label'] })
    const scene = sceneOf(api)!
    expect(scene.map((element) => element.id)).toEqual(['link'])
    expect(scene[0]).toMatchObject({ startBinding: null })
  })

  it('allows a self-contained delete (container + label) without includeRelated', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box' })
    const elements = [container, label]
    const api = fakeApi(elements)
    const result = (await run(api, 'delete', {
      elements: refs(elements, ['box', 'label']),
      expectedSceneVersion: sceneVersion(elements)
    })) as { deleted: number }
    expect(result.deleted).toBe(2)
    expect(sceneOf(api)!).toHaveLength(0)
  })
})

describe('structure: align, distribute, stack', () => {
  it('aligns specified elements to a shared left edge', async () => {
    const elements = [rect('a', { x: 0 }), rect('b', { x: 200 }), rect('c', { x: 500 })]
    const api = fakeApi(elements)
    const result = (await run(api, 'align', {
      elements: refs(elements, ['a', 'b', 'c']),
      axis: 'x',
      position: 'start',
      expectedSceneVersion: sceneVersion(elements)
    })) as { updated: number }
    expect(result.updated).toBe(2) // b and c move to x=0
    const scene = sceneOf(api)!
    expect(scene.find((element) => element.id === 'b')).toMatchObject({ x: 0 })
    expect(scene.find((element) => element.id === 'c')).toMatchObject({ x: 0 })
  })

  it('treats a single-element align as a no-op', async () => {
    const elements = [rect('a')]
    const api = fakeApi(elements)
    await expect(
      run(api, 'align', {
        elements: refs(elements, ['a']),
        axis: 'x',
        position: 'center',
        expectedSceneVersion: sceneVersion(elements)
      })
    ).resolves.toMatchObject({ updated: 0 })
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('treats an empty selection as a no-op', async () => {
    const api = fakeApi([rect('a')], { selectedElementIds: {} })
    await expect(run(api, 'align', { axis: 'y', position: 'center' })).resolves.toMatchObject({
      updated: 0
    })
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('distributes three elements to equal gaps, keeping the ends fixed', async () => {
    const elements = [
      rect('a', { x: 0, width: 100 }),
      rect('b', { x: 150, width: 100 }),
      rect('c', { x: 600, width: 100 })
    ]
    const api = fakeApi(elements)
    const result = (await run(api, 'distribute', {
      elements: refs(elements, ['a', 'b', 'c']),
      axis: 'x',
      expectedSceneVersion: sceneVersion(elements)
    })) as { updated: number }
    // span 0..700, sizes 300, free 400, gap 200 → b.left = 0+100+200 = 300
    const scene = sceneOf(api)!
    expect(scene.find((element) => element.id === 'a')).toMatchObject({ x: 0 })
    expect(scene.find((element) => element.id === 'b')).toMatchObject({ x: 300 })
    expect(scene.find((element) => element.id === 'c')).toMatchObject({ x: 600 })
    expect(result.updated).toBe(1)
  })

  it('stacks elements horizontally with spacing and centers them cross-axis', async () => {
    const elements = [
      rect('a', { x: 0, y: 0, width: 100, height: 100 }),
      rect('b', { x: 999, y: 50, width: 100, height: 40 })
    ]
    const api = fakeApi(elements)
    await run(api, 'stack', {
      elements: refs(elements, ['a', 'b']),
      direction: 'horizontal',
      spacing: 20,
      align: 'center',
      expectedSceneVersion: sceneVersion(elements)
    })
    const scene = sceneOf(api)!
    // b.left = a.left + a.width + spacing = 120; centered on a.cy (50) → top = 50 - 20 = 30
    expect(scene.find((element) => element.id === 'b')).toMatchObject({ x: 120, y: 30 })
  })
})

describe('structure: reorder layers', () => {
  it('brings elements to the front, keeping bound labels above their container', async () => {
    const a = rect('a')
    const container = rect('box', { x: 200, boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box' })
    const top = rect('top', { x: 400 })
    const elements = [a, container, label, top]
    const api = fakeApi(elements)
    await run(api, 'order', {
      elements: refs(elements, ['box']),
      operation: 'front',
      expectedSceneVersion: sceneVersion(elements)
    })
    expect(sceneOf(api)!.map((element) => element.id)).toEqual(['a', 'top', 'box', 'label'])
  })

  it('steps an element backward by one position', async () => {
    const elements = [rect('a'), rect('b', { x: 200 }), rect('c', { x: 400 })]
    const api = fakeApi(elements)
    await run(api, 'order', {
      elements: refs(elements, ['c']),
      operation: 'backward',
      expectedSceneVersion: sceneVersion(elements)
    })
    expect(sceneOf(api)!.map((element) => element.id)).toEqual(['a', 'c', 'b'])
  })

  it('does not update the scene when already at the front', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const api = fakeApi(elements)
    await expect(
      run(api, 'order', {
        elements: refs(elements, ['b']),
        operation: 'front',
        expectedSceneVersion: sceneVersion(elements)
      })
    ).resolves.toMatchObject({ updated: 0 })
    expect(api.updateScene).not.toHaveBeenCalled()
  })
})

describe('structure: relationship-aware transform', () => {
  it('moves a container and carries its bound label', async () => {
    const container = rect('box', { boundElements: [{ id: 'label', type: 'text' }] })
    const label = text('label', 'Box', { containerId: 'box', x: 10, y: 40 })
    const api = fakeApi([container, label])
    const result = (await run(api, 'transform', {
      elements: [{ id: 'box', expectedVersion: 1, move: { dx: 30, dy: 0 } }]
    })) as { updated: number }
    expect(result.updated).toBe(2)
    const scene = sceneOf(api)!
    expect(scene.find((element) => element.id === 'box')).toMatchObject({ x: 30 })
    expect(scene.find((element) => element.id === 'label')).toMatchObject({ x: 40 })
  })

  it('moves a connector only when both bound endpoints move together', async () => {
    const a = rect('a', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const b = rect('b', { x: 300, boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', {
      x: 100,
      startBinding: { elementId: 'a', focus: 0, gap: 4 },
      endBinding: { elementId: 'b', focus: 0, gap: 4 }
    })
    const api = fakeApi([a, b, link])
    const result = (await run(api, 'transform', {
      elements: [
        { id: 'a', expectedVersion: 1, move: { dx: 10, dy: 5 } },
        { id: 'b', expectedVersion: 1, move: { dx: 10, dy: 5 } }
      ]
    })) as { updated: number }
    expect(result.updated).toBe(3) // a, b, and the connector
    expect(sceneOf(api)!.find((element) => element.id === 'link')).toMatchObject({ x: 110, y: 5 })
  })

  it('rejects moving only one end of a bound connector', async () => {
    const a = rect('a', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const b = rect('b', { x: 300, boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', {
      startBinding: { elementId: 'a', focus: 0, gap: 4 },
      endBinding: { elementId: 'b', focus: 0, gap: 4 }
    })
    const api = fakeApi([a, b, link])
    await expect(
      run(api, 'transform', {
        elements: [{ id: 'a', expectedVersion: 1, move: { dx: 10, dy: 0 } }]
      })
    ).rejects.toThrow('move both endpoints together')
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('resizes a shape and re-centers its bound label', async () => {
    const container = rect('box', {
      width: 100,
      height: 100,
      boundElements: [{ id: 'label', type: 'text' }]
    })
    const label = text('label', 'Box', { containerId: 'box', x: 25, y: 40, width: 50, height: 20 })
    const api = fakeApi([container, label])
    await run(api, 'transform', {
      elements: [{ id: 'box', expectedVersion: 1, resize: { width: 200 } }]
    })
    const scene = sceneOf(api)!
    expect(scene.find((element) => element.id === 'box')).toMatchObject({ width: 200 })
    // container center x = 100, label width 50 → label.x = 75
    expect(scene.find((element) => element.id === 'label')).toMatchObject({ x: 75 })
  })

  it('rejects resizing a shape that has connector bindings', async () => {
    const box = rect('box', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', { startBinding: { elementId: 'box', focus: 0, gap: 4 } })
    const api = fakeApi([box, link])
    await expect(
      run(api, 'transform', {
        elements: [{ id: 'box', expectedVersion: 1, resize: { width: 200 } }]
      })
    ).rejects.toThrow('would distort')
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('rejects stale and locked transforms before mutating', async () => {
    const stale = fakeApi([rect('box', { version: 5 })])
    await expect(
      run(stale, 'transform', {
        elements: [{ id: 'box', expectedVersion: 2, move: { dx: 1, dy: 1 } }]
      })
    ).rejects.toThrow('stale')
    expect(stale.updateScene).not.toHaveBeenCalled()

    const locked = fakeApi([rect('box', { locked: true })])
    await expect(
      run(locked, 'transform', {
        elements: [{ id: 'box', expectedVersion: 1, move: { dx: 1, dy: 1 } }]
      })
    ).rejects.toThrow('locked')
    expect(locked.updateScene).not.toHaveBeenCalled()
  })
})
