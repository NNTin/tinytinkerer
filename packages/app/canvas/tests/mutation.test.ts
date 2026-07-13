import { describe, expect, it, vi } from 'vitest'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { attachBoundedRecords, versionReceipts } from '../src/mutation'

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

const scene = (elements: Array<Record<string, unknown>>): readonly OrderedExcalidrawElement[] =>
  elements as unknown as readonly OrderedExcalidrawElement[]

describe('versionReceipts', () => {
  it('returns {id, version} receipts in the order of the input ids', () => {
    const elements = scene([
      rect('a', { version: 1 }),
      rect('b', { version: 5 }),
      rect('c', { version: 9 })
    ])
    expect(versionReceipts(elements, ['c', 'a'])).toEqual([
      { id: 'c', version: 9 },
      { id: 'a', version: 1 }
    ])
  })

  it('throws for an id missing from the updated scene', () => {
    const elements = scene([rect('a')])
    expect(() => versionReceipts(elements, ['a', 'ghost'])).toThrow(
      'receipt: element "ghost" is missing after the update'
    )
  })

  it('reads element ids O(n) times for n changed elements, not O(n²)', () => {
    const n = 500
    let idReads = 0
    const elements = scene(
      Array.from({ length: n }, (_, position) => {
        const element = rect(`unused-${position}`, { version: position + 1 })
        Object.defineProperty(element, 'id', {
          get() {
            idReads += 1
            return `element-${position}`
          },
          enumerable: true
        })
        return element
      })
    )
    const ids = Array.from({ length: n }, (_, position) => `element-${position}`)
    idReads = 0
    const receipts = versionReceipts(elements, ids)
    expect(receipts).toHaveLength(n)
    expect(receipts[0]).toEqual({ id: 'element-0', version: 1 })
    expect(receipts[n - 1]).toEqual({ id: `element-${n - 1}`, version: n })
    // The old per-id `.find` scan read ~n²/2 ids (~125,000); one index pass reads n.
    expect(idReads).toBeLessThanOrEqual(4 * n)
  })
})

describe('attachBoundedRecords', () => {
  it('returns normalized records for the given ids with truncation metadata', () => {
    const elements = scene([rect('a', { version: 3 }), rect('b', { version: 7, x: 50 })])
    const result = attachBoundedRecords({ ok: true as const }, elements, ['b', 'a'], 4096)
    expect(result.ok).toBe(true)
    expect(result.elements.map((element) => element.id)).toEqual(['b', 'a'])
    expect(result.elements[0]).toMatchObject({ id: 'b', version: 7, zIndex: 1, x: 50 })
    expect(result.elements[1]).toMatchObject({ id: 'a', version: 3, zIndex: 0 })
    expect(result.truncation).toMatchObject({
      truncated: false,
      fields: [],
      omittedElements: 0,
      budgetBytes: 4096
    })
    expect(result.truncation.serializedBytes).toBeGreaterThan(0)
  })

  it('drops trailing records past the byte budget and reports the omission', () => {
    const elements = scene([rect('a'), rect('b')])
    const result = attachBoundedRecords({ ok: true as const }, elements, ['a', 'b'], 300)
    expect(result.elements.length).toBeLessThan(2)
    expect(result.truncation.truncated).toBe(true)
    expect(result.truncation.omittedElements).toBe(2 - result.elements.length)
    expect(result.truncation.serializedBytes).toBeLessThanOrEqual(300)
  })
})
