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

describe('bind: attach, detach, rebind', () => {
  it('attaches a connector start to a target, anchoring on the facing edge', async () => {
    const a = rect('a')
    const link = arrow('link')
    const elements = [a, link]
    const api = fakeApi(elements)

    const result = (await run(api, 'bind', {
      connector: { id: 'link', expectedVersion: 1 },
      start: { action: 'attach', target: { id: 'a', expectedVersion: 1 } },
      expectedSceneVersion: sceneVersion(elements)
    })) as { updated: number; start: { bound: boolean; targetId: string | null } }

    expect(result.start).toMatchObject({ bound: true, targetId: 'a' })
    const scene = sceneOf(api)!
    const boundLink = find(scene, 'link')!
    // a's right edge is x=100; gap 4 → 104, centered focus 0 → y=50.
    expect(boundLink).toMatchObject({ x: 104, y: 50 })
    expect(boundLink.startBinding).toMatchObject({ elementId: 'a', focus: 0, gap: 4 })
    expect(find(scene, 'a')!.boundElements).toEqual([{ id: 'link', type: 'arrow' }])
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    )
  })

  it('honors an explicit anchor focus/gap', async () => {
    const a = rect('a')
    const link = arrow('link')
    const elements = [a, link]
    const api = fakeApi(elements)
    await run(api, 'bind', {
      connector: { id: 'link', expectedVersion: 1 },
      start: {
        action: 'attach',
        target: { id: 'a', expectedVersion: 1 },
        anchor: { focus: 0.5, gap: 10 }
      },
      expectedSceneVersion: sceneVersion(elements)
    })
    const boundLink = find(sceneOf(api), 'link')!
    // right edge 100 + gap 10 = 110; y = 50 + 0.5 * (100/2) = 75.
    expect(boundLink).toMatchObject({ x: 110, y: 75 })
    expect(boundLink.startBinding).toMatchObject({ focus: 0.5, gap: 10 })
  })

  it('detaches an endpoint and removes the reverse reference', async () => {
    const a = rect('a', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', { startBinding: { elementId: 'a', focus: 0, gap: 4 } })
    const elements = [a, link]
    const api = fakeApi(elements)

    const result = (await run(api, 'bind', {
      connector: { id: 'link', expectedVersion: 1 },
      start: { action: 'detach' },
      expectedSceneVersion: sceneVersion(elements)
    })) as { start: { bound: boolean } }

    expect(result.start.bound).toBe(false)
    const scene = sceneOf(api)!
    expect(find(scene, 'link')!.startBinding).toBeNull()
    expect(find(scene, 'a')!.boundElements).toEqual([])
  })

  it('rebinds a start from one target to another, moving the reverse reference', async () => {
    const a = rect('a', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const b = rect('b', { x: 400 })
    const link = arrow('link', { startBinding: { elementId: 'a', focus: 0, gap: 4 } })
    const elements = [a, b, link]
    const api = fakeApi(elements)
    await run(api, 'bind', {
      connector: { id: 'link', expectedVersion: 1 },
      start: { action: 'attach', target: { id: 'b', expectedVersion: 1 } },
      expectedSceneVersion: sceneVersion(elements)
    })
    const scene = sceneOf(api)!
    expect(find(scene, 'a')!.boundElements).toEqual([])
    expect(find(scene, 'b')!.boundElements).toEqual([{ id: 'link', type: 'arrow' }])
    expect(find(scene, 'link')!.startBinding).toMatchObject({ elementId: 'b' })
  })

  it('rejects an unknown connector, a stale connector, and a stale target', async () => {
    const elements = [rect('a'), arrow('link', { version: 1 })]
    const expected = sceneVersion(elements)
    const handle = fakeApi(elements)
    await expect(
      run(handle, 'bind', {
        connector: { id: 'ghost', expectedVersion: 1 },
        start: { action: 'detach' },
        expectedSceneVersion: expected
      })
    ).rejects.toThrow('does not exist')
    await expect(
      run(handle, 'bind', {
        connector: { id: 'link', expectedVersion: 9 },
        start: { action: 'detach' },
        expectedSceneVersion: expected
      })
    ).rejects.toThrow('stale')
    await expect(
      run(handle, 'bind', {
        connector: { id: 'link', expectedVersion: 1 },
        start: { action: 'attach', target: { id: 'a', expectedVersion: 9 } },
        expectedSceneVersion: expected
      })
    ).rejects.toThrow('stale')
    expect(handle.updateScene).not.toHaveBeenCalled()
  })

  it('rejects binding to a non-bindable element and to a degenerate point', async () => {
    const a = rect('a')
    const link = arrow('link')
    const other = arrow('other', { id: 'other' })
    const elements = [a, link, other]
    const api1 = fakeApi(elements)
    await expect(
      run(api1, 'bind', {
        connector: { id: 'link', expectedVersion: 1 },
        start: { action: 'attach', target: { id: 'other', expectedVersion: 1 } },
        expectedSceneVersion: sceneVersion(elements)
      })
    ).rejects.toThrow('not a bind target')

    const api2 = fakeApi([a, link])
    // Both endpoints anchored to the same target collapse onto one edge point.
    await expect(
      run(api2, 'bind', {
        connector: { id: 'link', expectedVersion: 1 },
        start: { action: 'attach', target: { id: 'a', expectedVersion: 1 } },
        end: { action: 'attach', target: { id: 'a', expectedVersion: 1 } },
        expectedSceneVersion: sceneVersion([a, link])
      })
    ).rejects.toThrow('zero length')
    expect(api2.updateScene).not.toHaveBeenCalled()
  })

  it('rejects a stale scene version before mutating', async () => {
    const elements = [rect('a'), arrow('link')]
    const api = fakeApi(elements)
    await expect(
      run(api, 'bind', {
        connector: { id: 'link', expectedVersion: 1 },
        start: { action: 'detach' },
        expectedSceneVersion: 999
      })
    ).rejects.toThrow('scene changed')
    expect(api.updateScene).not.toHaveBeenCalled()
  })
})

describe('transform: reflow connectors on move and resize', () => {
  it('re-anchors a connector when only one bound endpoint moves', async () => {
    const a = rect('a', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const b = rect('b', { x: 300, boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', {
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [200, 0]
      ],
      startBinding: { elementId: 'a', focus: 0, gap: 4 },
      endBinding: { elementId: 'b', focus: 0, gap: 4 }
    })
    const api = fakeApi([a, b, link])
    const result = (await run(api, 'transform', {
      elements: [{ id: 'a', expectedVersion: 1, move: { dx: 50, dy: 0 } }],
      reflowConnectors: true
    })) as { updated: number }
    const scene = sceneOf(api)!
    // a moved to 50..150; start re-anchors to its right edge (150 + gap 4 = 154).
    expect(find(scene, 'link')).toMatchObject({ x: 154, y: 50 })
    expect(result.updated).toBeGreaterThanOrEqual(2)
  })

  it('keeps the focus point valid when a bound shape resizes', async () => {
    const a = rect('a', { width: 100, height: 100, boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', {
      x: 100,
      y: 50,
      points: [
        [0, 0],
        [300, 0]
      ],
      startBinding: { elementId: 'a', focus: 0.5, gap: 4 },
      endBinding: null
    })
    const api = fakeApi([a, link])
    await run(api, 'transform', {
      elements: [{ id: 'a', expectedVersion: 1, resize: { width: 200 } }],
      reflowConnectors: true
    })
    const scene = sceneOf(api)!
    // a widened to 0..200; right edge 200 + gap 4 = 204; y = 50 + 0.5 * 50 = 75.
    expect(find(scene, 'link')).toMatchObject({ x: 204, y: 75 })
    // focus is preserved on the binding.
    expect(find(scene, 'link')!.startBinding).toMatchObject({ focus: 0.5, gap: 4 })
  })

  it('still rejects a one-sided move and a bound resize without the opt-in', async () => {
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
    ).rejects.toThrow('reflowConnectors')
    expect(api.updateScene).not.toHaveBeenCalled()
  })
})

describe('audit: stale, detached, ambiguous bindings', () => {
  const setup = (overrides: Record<string, unknown>) => {
    const a = rect('a', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', {
      x: 104,
      y: 50,
      points: [
        [0, 0],
        [100, 0]
      ],
      ...overrides
    })
    return fakeApi([a, link])
  }

  it('reports an unbound connector as healthy with no issues', async () => {
    const api = fakeApi([arrow('link')])
    const result = (await run(api, 'audit', {})) as {
      healthy: number
      flagged: number
      connectors: Array<{ start: { status: string }; end: { status: string }; issues: string[] }>
    }
    expect(result).toMatchObject({ healthy: 1, flagged: 0 })
    expect(result.connectors[0]).toMatchObject({
      start: { status: 'unbound' },
      end: { status: 'unbound' },
      issues: []
    })
  })

  it('reports an ok binding when the endpoint sits on its reciprocated target', async () => {
    const api = setup({ startBinding: { elementId: 'a', focus: 0, gap: 4 } })
    const result = (await run(api, 'audit', {})) as {
      connectors: Array<{ start: { status: string }; issues: string[] }>
    }
    expect(result.connectors[0]).toMatchObject({ start: { status: 'ok' }, issues: [] })
  })

  it('flags a detached binding the target does not reciprocate', async () => {
    const a = rect('a') // no boundElements back-reference
    const link = arrow('link', { startBinding: { elementId: 'a', focus: 0, gap: 4 } })
    const api = fakeApi([a, link])
    const result = (await run(api, 'audit', {})) as {
      flagged: number
      connectors: Array<{
        start: { status: string }
        issues: string[]
        repairs: Array<{ action: string }>
      }>
    }
    expect(result.flagged).toBe(1)
    expect(result.connectors[0]!.start.status).toBe('detached')
    expect(result.connectors[0]!.issues).toContain('detached')
    expect(result.connectors[0]!.repairs[0]).toMatchObject({ endpoint: 'start', action: 'rebind' })
  })

  it('flags an ambiguous binding to a missing element with a detach repair', async () => {
    const link = arrow('link', { startBinding: { elementId: 'ghost', focus: 0, gap: 4 } })
    const api = fakeApi([link])
    const result = (await run(api, 'audit', {})) as {
      connectors: Array<{ start: { status: string }; repairs: Array<{ action: string }> }>
    }
    expect(result.connectors[0]!.start.status).toBe('ambiguous')
    expect(result.connectors[0]!.repairs[0]).toMatchObject({ endpoint: 'start', action: 'detach' })
  })

  it('flags a stale binding whose endpoint drifted off the target', async () => {
    const a = rect('a', { boundElements: [{ id: 'link', type: 'arrow' }] })
    const link = arrow('link', {
      x: 600,
      y: 600,
      points: [
        [0, 0],
        [100, 0]
      ],
      startBinding: { elementId: 'a', focus: 0, gap: 4 }
    })
    const api = fakeApi([a, link])
    const result = (await run(api, 'audit', {})) as {
      connectors: Array<{ start: { status: string }; repairs: Array<{ action: string }> }>
    }
    expect(result.connectors[0]!.start.status).toBe('stale')
    expect(result.connectors[0]!.repairs[0]).toMatchObject({ action: 'rebind' })
  })

  it('omits repairs at summary detail and scopes by connectorIds', async () => {
    const a = rect('a')
    const link = arrow('link', { startBinding: { elementId: 'a', focus: 0, gap: 4 } })
    const other = arrow('other', { id: 'other' })
    const api = fakeApi([a, link, other])
    const summary = (await run(api, 'audit', { detail: 'summary' })) as {
      connectors: Array<{ id: string; repairs: unknown[] }>
    }
    expect(summary.connectors).toHaveLength(2)
    expect(summary.connectors.every((connector) => connector.repairs.length === 0)).toBe(true)

    const scoped = (await run(api, 'audit', { connectorIds: ['link', 'missing'] })) as {
      connectors: Array<{ id: string }>
      missingIds: string[]
    }
    expect(scoped.connectors.map((connector) => connector.id)).toEqual(['link'])
    expect(scoped.missingIds).toEqual(['missing'])
  })

  it('rejects a stale scene version for paged audits', async () => {
    const api = fakeApi([arrow('link')])
    await expect(run(api, 'audit', { offset: 0, expectedSceneVersion: 999 })).rejects.toThrow(
      'scene changed'
    )
  })
})
