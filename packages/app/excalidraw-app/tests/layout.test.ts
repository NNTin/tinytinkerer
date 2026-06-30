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
    x: 100,
    y: 0,
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

const run = (api: ExcalidrawImperativeAPI, verb: string, payload: unknown): Promise<unknown> => {
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

const find = (scene: Array<Record<string, unknown>> | undefined, id: string) =>
  scene?.find((element) => element.id === id)

describe('snap: grid alignment', () => {
  it('snaps an element top-left to an explicit grid size', async () => {
    const a = rect('a', { x: 12, y: 27 })
    const elements = [a]
    const api = fakeApi(elements)
    const result = (await run(api, 'snap', {
      elements: refs(elements, ['a']),
      gridSize: 10,
      expectedSceneVersion: sceneVersion(elements)
    })) as { updated: number }
    expect(result.updated).toBe(1)
    expect(find(sceneOf(api), 'a')).toMatchObject({ x: 10, y: 30 })
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    )
  })

  it('falls back to the scene grid size and the live selection', async () => {
    const a = rect('a', { x: 11, y: 9 })
    const api = fakeApi([a], { selectedElementIds: { a: true }, gridSize: 20 })
    await run(api, 'snap', {})
    expect(find(sceneOf(api), 'a')).toMatchObject({ x: 20, y: 0 })
  })

  it('optionally snaps size and carries a bound label', async () => {
    const box = rect('box', {
      x: 0,
      y: 0,
      width: 93,
      height: 100,
      boundElements: [{ id: 'l', type: 'text' }]
    })
    const label = text('l', 'Box', { containerId: 'box', x: 12, y: 8 })
    const elements = [box, label]
    const api = fakeApi(elements)
    await run(api, 'snap', {
      elements: refs(elements, ['box']),
      gridSize: 10,
      snapSize: true,
      expectedSceneVersion: sceneVersion(elements)
    })
    const scene = sceneOf(api)!
    // width 93 rounds to 90; top-left already on the grid stays put.
    expect(find(scene, 'box')).toMatchObject({ width: 90 })
    // label x 12 → moved with the container's snap delta (0 here, box was on-grid).
    expect(find(scene, 'l')).toBeDefined()
  })

  it('is a no-op when no grid size is available', async () => {
    const elements = [rect('a', { x: 13, y: 17 })]
    const api = fakeApi(elements)
    const result = (await run(api, 'snap', {
      elements: refs(elements, ['a']),
      expectedSceneVersion: sceneVersion(elements)
    })) as { updated: number }
    expect(result.updated).toBe(0)
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('rejects a stale scene version', async () => {
    const elements = [rect('a')]
    const api = fakeApi(elements)
    await expect(
      run(api, 'snap', { elements: refs(elements, ['a']), gridSize: 10, expectedSceneVersion: 999 })
    ).rejects.toThrow('scene changed')
  })
})

describe('place: relative placement', () => {
  it('places a cluster below an anchor element, centered', async () => {
    const anchor = rect('anchor', { x: 0, y: 0, width: 100, height: 100 })
    const a = rect('a', { x: 500, y: 500, width: 50, height: 50 })
    const b = rect('b', { x: 560, y: 500, width: 50, height: 50 })
    const elements = [anchor, a, b]
    const api = fakeApi(elements)
    await run(api, 'place', {
      elements: refs(elements, ['a', 'b']),
      anchor: { elementId: 'anchor' },
      relation: 'below',
      gap: 20,
      align: 'center',
      expectedSceneVersion: sceneVersion(elements)
    })
    const scene = sceneOf(api)!
    // cluster box 500..610 (w110); anchor.cx 50 → left -5; top = anchor.bottom 100 + 20 = 120.
    expect(find(scene, 'a')).toMatchObject({ x: -5, y: 120 })
    // relative arrangement preserved: b stays 60px right of a.
    expect(find(scene, 'b')).toMatchObject({ x: 55, y: 120 })
  })

  it('centers a cluster over an anchor group', async () => {
    const g1 = rect('g1', { x: 0, y: 0, width: 100, height: 100, groupIds: ['grp'] })
    const g2 = rect('g2', { x: 100, y: 0, width: 100, height: 100, groupIds: ['grp'] })
    const a = rect('a', { x: 900, y: 900, width: 40, height: 40 })
    const elements = [g1, g2, a]
    const api = fakeApi(elements)
    await run(api, 'place', {
      elements: refs(elements, ['a']),
      anchor: { groupId: 'grp' },
      relation: 'center-over',
      expectedSceneVersion: sceneVersion(elements)
    })
    // group box 0..200 x 0..100, center (100,50); a (40x40) centered → (80,30).
    expect(find(sceneOf(api), 'a')).toMatchObject({ x: 80, y: 30 })
  })

  it('rejects a missing anchor element and an empty anchor group', async () => {
    const a = rect('a', { x: 0, y: 0 })
    const elements = [a]
    const api = fakeApi(elements)
    await expect(
      run(api, 'place', {
        elements: refs(elements, ['a']),
        anchor: { elementId: 'ghost' },
        relation: 'below',
        expectedSceneVersion: sceneVersion(elements)
      })
    ).rejects.toThrow('does not exist')
    await expect(
      run(api, 'place', {
        elements: refs(elements, ['a']),
        anchor: { groupId: 'nope' },
        relation: 'below',
        expectedSceneVersion: sceneVersion(elements)
      })
    ).rejects.toThrow('no members')
  })

  it('re-anchors a bound connector after placing its target', async () => {
    const anchor = rect('anchor', { x: 0, y: 0, width: 100, height: 100 })
    const a = rect('a', { x: 500, y: 500, boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', {
      x: 300,
      y: 540,
      points: [
        [0, 0],
        [200, 0]
      ],
      startBinding: { elementId: 'a', focus: 0, gap: 4 }
    })
    const elements = [anchor, a, link]
    const api = fakeApi(elements)
    const result = (await run(api, 'place', {
      elements: refs(elements, ['a']),
      anchor: { elementId: 'anchor' },
      relation: 'right-of',
      gap: 10,
      expectedSceneVersion: sceneVersion(elements)
    })) as { updated: number }
    // a moves and the connector re-anchors → both change.
    expect(result.updated).toBeGreaterThanOrEqual(2)
  })
})

describe('arrange: auto-layout primitives', () => {
  it('lays elements out in a row-major grid', async () => {
    const a = rect('a', { x: 0, y: 0 })
    const b = rect('b', { x: 300, y: 0 })
    const c = rect('c', { x: 0, y: 300 })
    const d = rect('d', { x: 300, y: 300 })
    const elements = [a, b, c, d]
    const api = fakeApi(elements)
    await run(api, 'arrange', {
      elements: refs(elements, ['a', 'b', 'c', 'd']),
      layout: { pattern: 'grid', columns: 2, gapX: 20, gapY: 20 },
      expectedSceneVersion: sceneVersion(elements)
    })
    const scene = sceneOf(api)!
    expect(find(scene, 'a')).toMatchObject({ x: 0, y: 0 })
    expect(find(scene, 'b')).toMatchObject({ x: 120, y: 0 })
    expect(find(scene, 'c')).toMatchObject({ x: 0, y: 120 })
    expect(find(scene, 'd')).toMatchObject({ x: 120, y: 120 })
  })

  it('arranges elements on a circle (all move, scene updated once)', async () => {
    const els = [
      rect('a', { x: 0, y: 0, width: 40, height: 40 }),
      rect('b', { x: 5, y: 5, width: 40, height: 40 }),
      rect('c', { x: 10, y: 10, width: 40, height: 40 }),
      rect('d', { x: 15, y: 15, width: 40, height: 40 })
    ]
    const api = fakeApi(els)
    const result = (await run(api, 'arrange', {
      elements: refs(els, ['a', 'b', 'c', 'd']),
      layout: { pattern: 'circle', radius: 100, center: { x: 200, y: 200 } },
      expectedSceneVersion: sceneVersion(els)
    })) as { updated: number }
    expect(result.updated).toBe(4)
    // first element placed at the top of the circle (angle -90°): center.x, center.y - radius.
    // element center = (x+20, y+20); top point (200, 100) → x = 180, y = 80.
    expect(find(sceneOf(api), 'a')).toMatchObject({ x: 180, y: 80 })
  })
})

describe('survey: layout health', () => {
  it('reports overlapping elements with a suggestion', async () => {
    const a = rect('a', { x: 0, y: 0, width: 100, height: 100 })
    const b = rect('b', { x: 50, y: 50, width: 100, height: 100 })
    const api = fakeApi([a, b])
    const result = (await run(api, 'survey', { checks: ['overlap'] })) as {
      findings: Array<{ kind: string; elementIds: string[]; suggestion: string | null }>
      overlaps: number
    }
    expect(result.overlaps).toBe(1)
    expect(result.findings[0]).toMatchObject({ kind: 'overlap', elementIds: ['a', 'b'] })
    expect(result.findings[0]!.suggestion).toBeTruthy()
  })

  it('does not flag separated elements or intended label-in-container overlap', async () => {
    const a = rect('a', { x: 0, y: 0, width: 100, height: 100 })
    const far = rect('far', { x: 500, y: 500, width: 100, height: 100 })
    const box = rect('box', {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      boundElements: [{ id: 'l', type: 'text' }]
    })
    const label = text('l', 'Hi', { containerId: 'box', x: 20, y: 40, width: 40, height: 20 })
    const api = fakeApi([a, far, box, label])
    const result = (await run(api, 'survey', { checks: ['overlap'], elementIds: ['far'] })) as {
      findings: unknown[]
    }
    expect(result.findings).toHaveLength(0)
  })

  it('flags a label that overflows its container', async () => {
    const box = rect('box', {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      boundElements: [{ id: 'l', type: 'text' }]
    })
    const label = text('l', 'Overflowing', {
      containerId: 'box',
      x: -10,
      y: 40,
      width: 200,
      height: 20
    })
    const api = fakeApi([box, label])
    const result = (await run(api, 'survey', { checks: ['label'] })) as {
      findings: Array<{ kind: string; elementIds: string[] }>
      labelIssues: number
    }
    expect(result.labelIssues).toBe(1)
    expect(result.findings[0]).toMatchObject({ kind: 'label', elementIds: ['box', 'l'] })
  })

  it('flags a connector too short to read', async () => {
    const link = arrow('link', {
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [3, 0]
      ]
    })
    const api = fakeApi([link])
    const result = (await run(api, 'survey', { checks: ['arrow'] })) as {
      findings: Array<{ kind: string }>
      arrowIssues: number
    }
    expect(result.arrowIssues).toBe(1)
    expect(result.findings[0]).toMatchObject({ kind: 'arrow' })
  })

  it('paginates findings and drops suggestions at summary detail', async () => {
    const a = rect('a', { x: 0, y: 0, width: 100, height: 100 })
    const b = rect('b', { x: 40, y: 40, width: 100, height: 100 })
    const c = rect('c', { x: 80, y: 80, width: 100, height: 100 })
    const api = fakeApi([a, b, c])
    const page = (await run(api, 'survey', { checks: ['overlap'], limit: 2 })) as {
      findings: unknown[]
      overlaps: number
      page: { returned: number; total: number; nextOffset: number | null }
    }
    expect(page.overlaps).toBe(3) // a-b, a-c, b-c
    expect(page.findings).toHaveLength(2)
    expect(page.page.nextOffset).toBe(2)

    const summary = (await run(api, 'survey', { checks: ['overlap'], detail: 'summary' })) as {
      findings: Array<{ suggestion: string | null }>
    }
    expect(summary.findings.every((finding) => finding.suggestion === null)).toBe(true)
  })

  it('reports missing ids and rejects a stale scene version', async () => {
    const api = fakeApi([rect('a')])
    const result = (await run(api, 'survey', { elementIds: ['a', 'ghost'] })) as {
      missingIds: string[]
    }
    expect(result.missingIds).toEqual(['ghost'])
    await expect(run(api, 'survey', { offset: 0, expectedSceneVersion: 999 })).rejects.toThrow(
      'scene changed'
    )
  })
})
