import { describe, expect, it, vi } from 'vitest'
import { exportToCanvas as exportToCanvasImport } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { EXCALIDRAW_PAYLOAD_BUDGETS } from '@tinytinkerer/excalidraw-protocol'
import type { ThumbnailInput } from '@tinytinkerer/excalidraw-protocol'
import { executeThumbnail } from '../src/thumbnail'

// Spec calls for `importOriginal` here (thumbnail is the one verb that calls a
// real upstream renderer, `exportToCanvas`, worth exercising against the real
// package rather than hand-mocking). In this environment the pinned 0.18.1
// package's "dev" build itself fails to import under Vitest/Node ESM (a
// transitive `roughjs/bin/rough` extensionless import — an upstream packaging
// bug unrelated to our code), so `importOriginal` cannot load it. Falling back
// to a full manual mock, matching the `hashElementsVersion` convention (sum of
// element versions) the rest of this suite already uses.
vi.mock('@excalidraw/excalidraw', () => ({
  hashElementsVersion: (elements: Array<{ version: number }>) =>
    elements.reduce((version, element) => version + element.version, 0),
  exportToCanvas: vi.fn()
}))

// `exportToCanvas`'s real type resolves to `any` in this repo (see the note in
// src/thumbnail.ts), so re-type the mocked binding once here for a type-safe
// `mockResolvedValueOnce`/`toHaveBeenCalledWith` in the tests below.
type FakeCanvas = { width: number; height: number; toDataURL: (mimeType?: string) => string }
type FakeExportOpts = {
  elements: unknown[]
  appState?: { exportBackground?: boolean; viewBackgroundColor?: string }
  files: unknown
  maxWidthOrHeight?: number
}
const exportToCanvas = vi.mocked(
  exportToCanvasImport as unknown as (opts: FakeExportOpts) => Promise<FakeCanvas>
)

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

const sceneVersion = (elements: Array<Record<string, unknown>>): number =>
  elements.reduce((sum, element) => sum + (element.version as number), 0)

const stubCanvas = (width: number, height: number, dataUrl: string) => ({
  width,
  height,
  toDataURL: vi.fn(() => dataUrl)
})

const fakeApi = (elements: unknown[] = []): ExcalidrawImperativeAPI =>
  ({
    getSceneElements: vi.fn(() => elements),
    getAppState: vi.fn(() => ({ viewBackgroundColor: '#ffffff' })),
    getFiles: vi.fn(() => ({}))
  }) as unknown as ExcalidrawImperativeAPI

const input = (overrides: Partial<ThumbnailInput> = {}): ThumbnailInput => ({
  maxDimension: 512,
  background: true,
  ...overrides
})

describe('thumbnail: whole-scene export', () => {
  it('exports every scene element and reports the scene version', async () => {
    const elements = [rect('a'), rect('b', { x: 200 })]
    const api = fakeApi(elements)
    exportToCanvas.mockResolvedValueOnce(stubCanvas(512, 384, 'data:image/png;base64,AAA'))

    const result = await executeThumbnail(api, input())

    expect(exportToCanvas).toHaveBeenCalledWith({
      elements,
      files: {},
      maxWidthOrHeight: 512,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff' }
    })
    expect(result).toMatchObject({
      ok: true,
      elementCount: 2,
      missingIds: [],
      sceneVersion: sceneVersion(elements)
    })
    expect(result.media).toHaveLength(1)
    expect(result.media[0]).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      width: 512,
      height: 384
    })
    expect(result.media[0]!.description.length).toBeGreaterThan(0)
  })
})

describe('thumbnail: scoped export', () => {
  it('exports only the requested ids and reports missing ones', async () => {
    const elements = [rect('a'), rect('b', { x: 200 }), rect('c', { x: 400 })]
    const api = fakeApi(elements)
    exportToCanvas.mockResolvedValueOnce(stubCanvas(256, 256, 'data:image/png;base64,BBB'))

    const result = await executeThumbnail(
      api,
      input({ elementIds: ['a', 'c', 'ghost'], maxDimension: 256, background: false })
    )

    expect(exportToCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ elements: [elements[0], elements[2]] })
    )
    expect(result.missingIds).toEqual(['ghost'])
    expect(result.elementCount).toBe(2)
  })
})

describe('thumbnail: errors', () => {
  it('throws for an empty scene', async () => {
    const api = fakeApi([])
    await expect(executeThumbnail(api, input())).rejects.toThrow('nothing to export')
  })

  it('throws when every requested id is missing', async () => {
    const api = fakeApi([rect('a')])
    await expect(executeThumbnail(api, input({ elementIds: ['ghost'] }))).rejects.toThrow(
      'nothing to export'
    )
  })

  it('throws the budget error for an oversized dataUrl', async () => {
    const api = fakeApi([rect('a')])
    const oversized = `data:image/png;base64,${'A'.repeat(EXCALIDRAW_PAYLOAD_BUDGETS.thumbnail.result)}`
    exportToCanvas.mockResolvedValueOnce(stubCanvas(1024, 1024, oversized))

    await expect(executeThumbnail(api, input({ maxDimension: 1024 }))).rejects.toThrow(
      /result is \d+ bytes; maximum is \d+ bytes/
    )
  })

  it('rejects a stale expectedSceneVersion', async () => {
    const elements = [rect('a')]
    const api = fakeApi(elements)
    await expect(
      executeThumbnail(api, input({ expectedSceneVersion: sceneVersion(elements) + 1 }))
    ).rejects.toThrow('scene changed')
  })
})
