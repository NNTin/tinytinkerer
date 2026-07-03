import { describe, expect, it, vi } from 'vitest'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { PresetInput } from '@tinytinkerer/excalidraw-protocol'
import { createExcalidrawHandlers } from '../src/bridge'
import { __presetInternals } from '../src/presets'

vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { IMMEDIATELY: 'immediately' },
  // Preserve our minted ids (element.id spreads over the placeholder) and skip the
  // bound-label expansion — the real component adds those, but the id + group wiring
  // is what we assert here.
  convertToExcalidrawElements: (elements: Array<Record<string, unknown>>) =>
    elements.map((element, index) => ({ id: `converted-${index}`, ...element })),
  getCommonBounds: (elements: Array<{ x: number; y: number; width: number; height: number }>) => {
    const x1 = Math.min(...elements.map((element) => element.x))
    const y1 = Math.min(...elements.map((element) => element.y))
    const x2 = Math.max(...elements.map((element) => element.x + element.width))
    const y2 = Math.max(...elements.map((element) => element.y + element.height))
    return [x1, y1, x2, y2]
  },
  hashElementsVersion: (elements: Array<{ version: number }>) =>
    elements.reduce((version, element) => version + (element.version ?? 0), 0)
}))

const rect = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  version: 1,
  groupIds: [],
  boundElements: null,
  ...overrides
})

const fakeApi = (elements: unknown[] = []): ExcalidrawImperativeAPI =>
  ({
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => ({
      selectedElementIds: {},
      selectedGroupIds: {},
      editingGroupId: null
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

describe('preset builders (pure)', () => {
  const kinds: PresetInput[] = [
    { kind: 'network', variant: 'star', x: 0, y: 0, replace: false },
    { kind: 'network', variant: 'edge', x: 0, y: 0, replace: false },
    { kind: 'flowchart', variant: 'linear', x: 0, y: 0, replace: false },
    { kind: 'flowchart', variant: 'decision', x: 0, y: 0, replace: false },
    { kind: 'uml', variant: 'class', x: 0, y: 0, replace: false },
    { kind: 'uml', variant: 'sequence', x: 0, y: 0, replace: false },
    { kind: 'uml', variant: 'usecase', x: 0, y: 0, replace: false },
    { kind: 'wireframe', variant: 'screen', x: 0, y: 0, replace: false },
    { kind: 'wireframe', variant: 'modal', x: 0, y: 0, replace: false }
  ]

  it('produces a non-empty build for every preset with unique keys and resolvable links', () => {
    for (const input of kinds) {
      const build = __presetInternals.buildPreset(input)
      expect(build.primitives.length).toBeGreaterThan(0)
      const keys = build.primitives.map((prim) => prim.key)
      expect(new Set(keys).size).toBe(keys.length) // no duplicate primitive keys
      // every connector endpoint referencing a key must resolve to a real primitive
      for (const link of build.links) {
        for (const endpoint of [link.from, link.to])
          if ('key' in endpoint) expect(keys).toContain(endpoint.key)
      }
    }
  })

  it('adds an optional heading above the scaffold', () => {
    const build = __presetInternals.buildPreset({
      kind: 'flowchart',
      variant: 'linear',
      x: 0,
      y: 0,
      replace: false,
      title: 'Checkout'
    })
    expect(build.primitives[0]).toMatchObject({
      key: 'preset-title',
      type: 'text',
      text: 'Checkout'
    })
  })

  it('builds each infrastructure icon as a grouped, captioned glyph', () => {
    const types = ['router', 'laptop', 'phone', 'cloud', 'server', 'printer'] as const
    for (const type of types) {
      const { build, icons } = __presetInternals.buildIcons({
        icons: [{ type, x: 0, y: 0 }],
        replace: false
      })
      expect(icons).toHaveLength(1)
      // every primitive is in the icon's group, and there is a caption + a body anchor
      expect(build.primitives.every((prim) => prim.group === 'icon0')).toBe(true)
      expect(build.primitives.some((prim) => prim.key === 'icon0-body')).toBe(true)
      expect(build.primitives.some((prim) => prim.type === 'text')).toBe(true)
    }
    // cloud defaults to the "Internet" caption
    const { icons } = __presetInternals.buildIcons({
      icons: [{ type: 'cloud', x: 0, y: 0 }],
      replace: false
    })
    expect(icons[0]?.label).toBe('Internet')
  })
})

describe('preset verb (executor)', () => {
  it('inserts a network star as one atomic, undoable, grouped update', async () => {
    const api = fakeApi()
    const result = (await run(api, 'preset', { kind: 'network', variant: 'star' })) as {
      ok: true
      kind: string
      variant: string
      drawn: number
      groupIds: string[]
      connectors: unknown[]
      createdIds: string[]
    }
    expect(result).toMatchObject({ ok: true, kind: 'network', variant: 'star' })
    // 5 icons (router + 4 devices) → 5 groups; a connector from the router to each device.
    expect(result.groupIds).toHaveLength(5)
    expect(result.connectors).toHaveLength(4)
    expect(result.createdIds.length).toBe(result.drawn - result.connectors.length)
    expect(api.updateScene).toHaveBeenCalledTimes(1)
    expect(api.updateScene).toHaveBeenCalledWith(
      expect.objectContaining({ captureUpdate: CaptureUpdateAction.IMMEDIATELY })
    )
    // every grouped element carries one of the reported group ids
    const grouped = (sceneOf(api) ?? []).filter(
      (element) => Array.isArray(element.groupIds) && (element.groupIds as unknown[]).length > 0
    )
    expect(grouped.length).toBeGreaterThan(0)
    for (const element of grouped)
      expect(result.groupIds).toContain((element.groupIds as string[])[0])
  })

  it('replaces the canvas when asked and reports the resulting scene version', async () => {
    const api = fakeApi([rect('old', { version: 3 })])
    const result = (await run(api, 'preset', {
      kind: 'flowchart',
      variant: 'linear',
      replace: true
    })) as { replaced: boolean; sceneVersion: number }
    expect(result.replaced).toBe(true)
    // the prior element was cleared, so its version no longer contributes
    const scene = sceneOf(api) ?? []
    expect(scene.some((element) => element.id === 'old')).toBe(false)
  })

  it('rejects a stale scene version before writing anything (version-checked)', async () => {
    const api = fakeApi([rect('a', { version: 2 })])
    await expect(
      run(api, 'preset', { kind: 'uml', variant: 'class', expectedSceneVersion: 999 })
    ).rejects.toThrow('scene changed')
    expect(api.updateScene).not.toHaveBeenCalled()
  })
})

describe('icon verb (executor)', () => {
  it('inserts multiple icons, each grouped and mapped in the result', async () => {
    const api = fakeApi()
    const result = (await run(api, 'icon', {
      icons: [
        { type: 'router', x: 0, y: 0 },
        { type: 'server', x: 200, y: 0, label: 'DB' }
      ]
    })) as {
      icons: Array<{ type: string; label: string; groupId: string; elementIds: string[] }>
      groupIds: string[]
    }
    expect(result.icons).toHaveLength(2)
    expect(result.groupIds).toHaveLength(2)
    expect(result.icons[0]).toMatchObject({ type: 'router', label: 'Router' })
    expect(result.icons[1]).toMatchObject({ type: 'server', label: 'DB' })
    // group ids are distinct and each maps to real element ids
    expect(new Set(result.groupIds).size).toBe(2)
    expect(result.icons[1]?.elementIds.length).toBeGreaterThan(0)
  })

  it('tolerates overlapping placement (appends both without error)', async () => {
    const api = fakeApi()
    const result = (await run(api, 'icon', {
      icons: [
        { type: 'laptop', x: 10, y: 10 },
        { type: 'phone', x: 10, y: 10 }
      ]
    })) as { drawn: number; icons: unknown[] }
    expect(result.icons).toHaveLength(2)
    expect(result.drawn).toBeGreaterThan(0)
    expect(api.updateScene).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty batch and an unknown icon type at the schema', () => {
    const api = fakeApi()
    // The input schema validates before the handler runs, so these throw synchronously.
    expect(() => run(api, 'icon', { icons: [] })).toThrow()
    expect(() => run(api, 'icon', { icons: [{ type: 'satellite', x: 0, y: 0 }] })).toThrow()
    expect(api.updateScene).not.toHaveBeenCalled()
  })
})
