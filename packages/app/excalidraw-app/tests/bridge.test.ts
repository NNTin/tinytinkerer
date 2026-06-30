import { describe, expect, it, vi } from 'vitest'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { createExcalidrawHandlers } from '../src/bridge'

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
    const changed = Object.entries(updates).some(([key, value]) => element[key] !== value)
    return changed ? { ...element, ...updates, version: element.version + 1 } : element
  }
}))

const baseElement = (
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id,
  type: 'rectangle',
  x: 10,
  y: 20,
  width: 120,
  height: 80,
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

const textElement = (
  id: string,
  text: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> =>
  baseElement(id, {
    type: 'text',
    text,
    originalText: text,
    fontSize: 20,
    fontFamily: 5,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    width: text.length * 10,
    height: 20,
    ...overrides
  })

const arrowElement = (id: string, overrides: Record<string, unknown> = {}) =>
  baseElement(id, {
    type: 'arrow',
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

const fakeApi = (
  elements: unknown[] = [],
  state: Record<string, unknown> = {}
): ExcalidrawImperativeAPI =>
  ({
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => ({
      scrollX: 10.4,
      scrollY: -5.6,
      zoom: { value: 0.75 },
      theme: 'light',
      viewBackgroundColor: '#fff',
      gridModeEnabled: false,
      gridSize: 20,
      gridStep: 5,
      selectedElementIds: {},
      selectedGroupIds: {},
      editingGroupId: null,
      width: 400,
      height: 300,
      ...state
    })),
    updateScene: vi.fn(),
    scrollToContent: vi.fn()
  }) as unknown as ExcalidrawImperativeAPI

type Verb =
  | 'draw'
  | 'search'
  | 'inspect'
  | 'read'
  | 'edit'
  | 'clear'
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
  if (!registration) throw new Error(`Missing Excalidraw handler: ${verb}`)
  if (typeof registration === 'function') return Promise.resolve(registration(payload))
  const input = registration.inputSchema.parse(payload)
  return Promise.resolve()
    .then(() => registration.handler(input))
    .then((result) => registration.resultSchema.parse(result))
}

describe('Excalidraw bridge handlers', () => {
  it('binds every advertised verb to a schema-validated handler', () => {
    const handlers = createExcalidrawHandlers(fakeApi())
    expect(Object.keys(handlers)).toEqual([
      'draw',
      'search',
      'inspect',
      'read',
      'edit',
      'clear',
      'group',
      'duplicate',
      'delete',
      'align',
      'distribute',
      'stack',
      'order',
      'transform',
      'bind',
      'audit',
      'snap',
      'place',
      'arrange',
      'survey'
    ])
  })

  it('converts and appends draw elements as an undoable update', async () => {
    const api = fakeApi([baseElement('existing')])
    const result = await run(api, 'draw', {
      elements: [
        { type: 'rectangle', x: 10, y: 20, text: 'Box' },
        { type: 'text', x: 40, y: 50, text: 'Hello' }
      ]
    })

    expect(result).toEqual({ ok: true, drawn: 2, replaced: false, connectors: [] })
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    )
    expect(JSON.stringify(vi.mocked(api.updateScene).mock.calls[0])).toContain('"existing"')
    expect(api.scrollToContent).toHaveBeenCalledWith(expect.any(Array), { fitToContent: true })
  })

  it('computes declarative connector endpoints after node layout', async () => {
    const api = fakeApi()
    const result = (await run(api, 'draw', {
      elements: [
        {
          id: 'router',
          type: 'rectangle',
          x: 10,
          y: 20,
          width: 120,
          height: 80,
          text: 'Router'
        },
        {
          id: 'switch',
          type: 'rectangle',
          x: 220,
          y: 0,
          width: 120,
          height: 120,
          text: 'Switch'
        }
      ],
      connectors: [
        {
          id: 'router-switch',
          type: 'arrow',
          from: { elementId: 'router', side: 'right' },
          to: { elementId: 'switch', side: 'left' },
          routing: 'horizontal',
          rowY: 60
        },
        {
          id: 'distribution-trunk',
          type: 'line',
          from: { x: 180, y: 60 },
          to: { x: 180, y: 180 },
          routing: 'vertical',
          trunkX: 180
        }
      ],
      replace: true
    })) as {
      drawn: number
      connectors: Array<{
        id: string
        type: 'arrow' | 'line'
        routing: 'horizontal' | 'vertical'
        start: [number, number]
        end: [number, number]
        horizontal: boolean
        vertical: boolean
        anchorRule: string
      }>
    }

    expect(result.drawn).toBe(4)
    expect(result.connectors).toEqual([
      {
        id: 'router-switch',
        type: 'arrow',
        routing: 'horizontal',
        start: [130, 60],
        end: [220, 60],
        anchorRule: 'horizontal-row',
        horizontal: true,
        vertical: false
      },
      {
        id: 'distribution-trunk',
        type: 'line',
        routing: 'vertical',
        start: [180, 60],
        end: [180, 180],
        anchorRule: 'vertical-trunk',
        horizontal: false,
        vertical: true
      }
    ])
    const update = vi.mocked(api.updateScene).mock.calls[0]?.[0]
    const elements = update?.elements as unknown as ReadonlyArray<Record<string, unknown>>
    expect(elements.find((element) => element.id === 'router-switch')).toMatchObject({
      x: 130,
      y: 60,
      width: 90,
      height: 0,
      points: [
        [0, 0],
        [90, 0]
      ]
    })
    expect(elements.find((element) => element.id === 'distribution-trunk')).toMatchObject({
      x: 180,
      y: 60,
      width: 0,
      height: 120,
      points: [
        [0, 0],
        [0, 120]
      ]
    })
  })

  it('searches compact candidates by label, type, selection, and viewport', async () => {
    const router = baseElement('router', {
      boundElements: [{ id: 'router-label', type: 'text' }]
    })
    const label = textElement('router-label', 'Core Router', { containerId: 'router' })
    const offscreen = baseElement('server', { type: 'ellipse', x: 800 })
    const api = fakeApi([router, label, offscreen], {
      selectedElementIds: { router: true }
    })

    await expect(
      run(api, 'search', { query: 'core', types: ['rectangle'] })
    ).resolves.toMatchObject({
      ok: true,
      sceneCount: 3,
      matched: 1,
      elements: [
        {
          id: 'router',
          type: 'rectangle',
          name: 'Core Router',
          bounds: { x: 10, y: 20, width: 120, height: 80 },
          zIndex: 0,
          selected: true
        }
      ]
    })
    expect((await run(api, 'search', { scope: 'viewport' })) as { matched: number }).toMatchObject({
      matched: 2
    })
    expect((await run(api, 'search', { scope: 'selection' })) as { matched: number }).toMatchObject(
      {
        matched: 1
      }
    )
    const summary = (await run(api, 'search', {
      query: 'router',
      detail: 'summary'
    })) as {
      detail: string
      elements: Array<Record<string, unknown>>
    }
    expect(summary.detail).toBe('summary')
    expect(summary.elements[0]).toMatchObject({ id: 'router' })
    expect(summary.elements[0]).not.toHaveProperty('name')
  })

  it('inspects scene, viewport, selection, and requested relationships', async () => {
    const router = baseElement('router', {
      groupIds: ['network'],
      boundElements: [{ id: 'router-label', type: 'text' }]
    })
    const label = textElement('router-label', 'Router', {
      containerId: 'router',
      groupIds: ['network']
    })
    const api = fakeApi([router, label], {
      selectedElementIds: { router: true },
      selectedGroupIds: { network: true },
      editingGroupId: 'network'
    })

    const result = (await run(api, 'inspect', {
      elementIds: ['router', 'missing']
    })) as Record<string, unknown>

    expect(result).toMatchObject({
      ok: true,
      scene: {
        elementCount: 2,
        visibleElementCount: 2,
        typeCounts: { rectangle: 1, text: 1 },
        viewport: { x: 0, y: 0, width: 400, height: 300, zoom: 0.75 },
        selection: {
          elementIds: ['router'],
          groupIds: ['network'],
          editingGroupId: 'network'
        }
      },
      elements: [
        {
          id: 'router',
          name: 'Router',
          groupIds: ['network'],
          boundElementIds: ['router-label']
        }
      ],
      missingIds: ['missing']
    })
  })

  it('reads normalized full content and omits upstream internal fields', async () => {
    const router = baseElement('router', {
      version: 4,
      boundElements: [
        { id: 'router-label', type: 'text' },
        { id: 'link', type: 'arrow' }
      ]
    })
    const label = textElement('router-label', 'Router', { containerId: 'router' })
    const link = arrowElement('link', {
      startBinding: { elementId: 'router', focus: 0, gap: 8 }
    })
    const api = fakeApi([router, label, link])

    const result = (await run(api, 'read', {
      elementIds: ['router', 'router-label', 'link', 'missing']
    })) as { elements: Array<Record<string, unknown>>; missingIds: string[] }

    expect(result.missingIds).toEqual(['missing'])
    expect(result.elements[0]).toMatchObject({
      id: 'router',
      kind: 'shape',
      version: 4,
      zIndex: 0,
      style: { strokeColor: '#1b1b1f', opacity: 100 },
      label: { elementId: 'router-label', text: 'Router' },
      capabilities: {
        requiresUnlock: false
      }
    })
    const capabilities = result.elements[0]?.capabilities as {
      editableFields: string[]
      restrictions: string[]
    }
    expect(capabilities.editableFields).toEqual(expect.arrayContaining(['strokeColor', 'locked']))
    expect(capabilities.restrictions).toContain('relationship-geometry')
    expect(result.elements[1]).toMatchObject({
      id: 'router-label',
      text: { text: 'Router', containerId: 'router' }
    })
    expect(result.elements[2]).toMatchObject({
      id: 'link',
      linear: {
        points: [
          [0, 0],
          [100, 0]
        ],
        startBinding: { elementId: 'router', focus: 0, gap: 8 }
      }
    })
    expect(result.elements[0]).not.toHaveProperty('seed')
    expect(result.elements[0]).not.toHaveProperty('versionNonce')
  })

  it('paginates a stable snapshot and rejects scene drift', async () => {
    const api = fakeApi([baseElement('first'), baseElement('second', { version: 2 })])
    const first = (await run(api, 'read', {
      elementIds: ['first', 'second'],
      limit: 1
    })) as { sceneVersion: number; page: { nextOffset: number } }
    expect(first.page.nextOffset).toBe(1)
    await expect(
      run(api, 'read', {
        elementIds: ['first', 'second'],
        offset: 1,
        limit: 1,
        expectedSceneVersion: first.sceneVersion + 1
      })
    ).rejects.toThrow('scene changed')
  })

  it('bounds detail fields and reports field truncation', async () => {
    const api = fakeApi([textElement('long', 'x'.repeat(9_000))])
    const result = (await run(api, 'read', {
      elementIds: ['long'],
      detail: 'full'
    })) as {
      elements: Array<{ text?: { text: string } }>
      truncation: { truncated: boolean; fields: string[]; serializedBytes: number }
    }
    expect(result.elements[0]?.text?.text).toHaveLength(8_192)
    expect(result.truncation.truncated).toBe(true)
    expect(result.truncation.fields).toContain('long.text.text')
    expect(result.truncation.serializedBytes).toBeLessThanOrEqual(64 * 1_024)
  })

  it('keeps paged read results inside the exact UTF-8 result budget', async () => {
    const elements = Array.from({ length: 10 }, (_, index) =>
      textElement(`long-${index}`, 'x'.repeat(9_000))
    )
    const result = (await run(fakeApi(elements), 'read', {
      elementIds: elements.map((element) => String(element.id)),
      detail: 'full',
      limit: 10
    })) as {
      elements: unknown[]
      truncation: { omittedElements: number; serializedBytes: number }
    }
    const actualBytes = new TextEncoder().encode(JSON.stringify(result)).byteLength
    expect(result.truncation.omittedElements).toBeGreaterThan(0)
    expect(result.truncation.serializedBytes).toBe(actualBytes)
    expect(actualBytes).toBeLessThanOrEqual(64 * 1_024)
  })

  it('applies a versioned edit batch atomically as one undoable update', async () => {
    const first = baseElement('first', { version: 2 })
    const second = baseElement('second', { type: 'ellipse', x: 200, version: 5 })
    const api = fakeApi([first, second])

    const result = (await run(api, 'edit', {
      edits: [
        {
          id: 'first',
          expectedVersion: 2,
          changes: { x: 50, backgroundColor: '#ffc9c9' }
        },
        { id: 'second', expectedVersion: 5, changes: { locked: true, opacity: 80 } }
      ]
    })) as { updated: number; elements: Array<Record<string, unknown>> }

    expect(result.updated).toBe(2)
    expect(result.elements[0]).toMatchObject({ id: 'first', version: 3, x: 50 })
    expect(result.elements[1]).toMatchObject({ id: 'second', version: 6, locked: true })
    expect(api.updateScene).toHaveBeenCalledTimes(1)
    const update = vi.mocked(api.updateScene).mock.calls[0]?.[0]
    expect(update?.elements).toHaveLength(2)
    expect(update?.captureUpdate).toBe(CaptureUpdateAction.IMMEDIATELY)
  })

  it('rejects stale or relationship-sensitive edits without a partial update', async () => {
    const related = baseElement('related', {
      version: 2,
      boundElements: [{ id: 'arrow', type: 'arrow' }]
    })
    const other = baseElement('other', { version: 3 })
    const staleApi = fakeApi([related, other])

    await expect(
      run(staleApi, 'edit', {
        edits: [
          { id: 'other', expectedVersion: 3, changes: { strokeColor: '#f00' } },
          { id: 'related', expectedVersion: 1, changes: { opacity: 50 } }
        ]
      })
    ).rejects.toThrow('stale')
    expect(staleApi.updateScene).not.toHaveBeenCalled()

    await expect(
      run(staleApi, 'edit', {
        edits: [{ id: 'related', expectedVersion: 2, changes: { x: 100 } }]
      })
    ).rejects.toThrow('relationship-geometry')
    expect(staleApi.updateScene).not.toHaveBeenCalled()
  })

  it('requires explicit unlock and safely remeasures standalone text', async () => {
    const locked = baseElement('locked', { locked: true, version: 2 })
    const title = textElement('title', 'Old', { version: 4 })
    const api = fakeApi([locked, title])

    await expect(
      run(api, 'edit', {
        edits: [{ id: 'locked', expectedVersion: 2, changes: { opacity: 50 } }]
      })
    ).rejects.toThrow('include locked:false')

    const result = (await run(api, 'edit', {
      edits: [
        {
          id: 'locked',
          expectedVersion: 2,
          changes: { locked: false, opacity: 50 }
        },
        { id: 'title', expectedVersion: 4, changes: { text: 'Longer title' } }
      ]
    })) as { elements: Array<Record<string, unknown>> }

    expect(result.elements[0]).toMatchObject({ id: 'locked', locked: false })
    expect(result.elements[1]).toMatchObject({
      id: 'title',
      width: 120,
      text: { text: 'Longer title' }
    })
  })

  it('returns no updates and creates no undo entry for an all-no-op edit', async () => {
    const existing = baseElement('existing', { version: 2 })
    const api = fakeApi([existing])

    await expect(
      run(api, 'edit', {
        edits: [{ id: 'existing', expectedVersion: 2, changes: { opacity: 100 } }]
      })
    ).resolves.toMatchObject({ ok: true, updated: 0 })
    expect(api.updateScene).not.toHaveBeenCalled()
  })

  it('retains every compact edit receipt when detailed records exceed budget', async () => {
    const elements = Array.from({ length: 20 }, (_, index) =>
      textElement(`text-${index}`, 'x'.repeat(9_000), { version: index + 1 })
    )
    const result = (await run(fakeApi(elements), 'edit', {
      edits: elements.map((element, index) => ({
        id: String(element.id),
        expectedVersion: index + 1,
        changes: { opacity: 99 }
      }))
    })) as {
      receipts: unknown[]
      elements: unknown[]
      truncation: { omittedElements: number; serializedBytes: number }
    }
    expect(result.receipts).toHaveLength(20)
    expect(result.elements.length).toBeLessThan(20)
    expect(result.truncation.omittedElements).toBe(20 - result.elements.length)
    expect(result.truncation.serializedBytes).toBeLessThanOrEqual(64 * 1_024)
  })

  it('clears the scene as an undoable update', async () => {
    const api = fakeApi([baseElement('existing')])
    await expect(run(api, 'clear', {})).resolves.toEqual({ ok: true })
    expect(api.updateScene).toHaveBeenCalledWith({
      elements: [],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    })
  })
})
