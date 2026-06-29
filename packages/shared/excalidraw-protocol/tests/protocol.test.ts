import { describe, expect, it } from 'vitest'
import {
  alignInputSchema,
  clearInputSchema,
  deleteInputSchema,
  distributeInputSchema,
  drawInputSchema,
  duplicateInputSchema,
  editInputSchema,
  excalidrawVerbContracts,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_VERBS,
  groupInputSchema,
  inspectInputSchema,
  orderInputSchema,
  readInputSchema,
  readElementSchema,
  searchInputSchema,
  stackInputSchema,
  transformInputSchema
} from '../src/index'

describe('excalidraw protocol', () => {
  it('accepts the model-facing draw vocabulary', () => {
    expect(
      drawInputSchema.parse({
        elements: [
          { id: 'start', type: 'rectangle', x: 10, y: 20, width: 120, height: 80, text: 'Start' },
          { type: 'arrow', x: 130, y: 60, strokeColor: '#111' }
        ],
        connectors: [
          {
            id: 'start-to-end',
            from: { elementId: 'start', side: 'right' },
            to: { x: 240, y: 60 },
            routing: 'horizontal',
            rowY: 60
          }
        ],
        replace: true
      })
    ).toMatchObject({ replace: true, connectors: [{ id: 'start-to-end', routing: 'horizontal' }] })
  })

  it('rejects empty, unknown, and malformed draw elements', () => {
    expect(drawInputSchema.safeParse({ elements: [] }).success).toBe(false)
    expect(drawInputSchema.safeParse({ elements: [{ type: 'image', x: 0, y: 0 }] }).success).toBe(
      false
    )
    expect(
      drawInputSchema.safeParse({ elements: [{ type: 'text', x: Number.NaN, y: 0 }] }).success
    ).toBe(false)
    expect(
      drawInputSchema.safeParse({
        elements: [{ id: 'same', type: 'rectangle', x: 0, y: 0 }],
        connectors: [{ id: 'same', from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }]
      }).success
    ).toBe(false)
  })

  it('defaults and bounds candidate search', () => {
    expect(searchInputSchema.parse({})).toEqual({
      scope: 'all',
      offset: 0,
      limit: 20,
      detail: 'standard'
    })
    expect(
      searchInputSchema.parse({
        query: 'router',
        types: ['rectangle', 'text'],
        scope: 'viewport',
        limit: 10
      })
    ).toMatchObject({ query: 'router', scope: 'viewport', limit: 10 })
    expect(searchInputSchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(searchInputSchema.safeParse({ types: ['text', 'text'] }).success).toBe(false)
  })

  it('supports scene inspection and requires ids for full reads', () => {
    expect(inspectInputSchema.safeParse({}).success).toBe(true)
    expect(inspectInputSchema.safeParse({ elementIds: ['shape-1'] }).success).toBe(true)
    expect(inspectInputSchema.safeParse({ elementIds: [] }).success).toBe(false)
    expect(readInputSchema.safeParse({ elementIds: ['shape-1'] }).success).toBe(true)
    expect(readInputSchema.safeParse({}).success).toBe(false)
    expect(readInputSchema.safeParse({ elementIds: ['shape-1', 'shape-1'] }).success).toBe(false)
    expect(readInputSchema.safeParse({ elementIds: ['shape-1'], offset: 1 }).success).toBe(false)
    expect(
      readInputSchema.parse({
        elementIds: ['shape-1'],
        offset: 1,
        expectedSceneVersion: 7,
        detail: 'full'
      })
    ).toMatchObject({ offset: 1, expectedSceneVersion: 7, detail: 'full' })
  })

  it('requires versioned, unique, non-empty edit patches', () => {
    expect(
      editInputSchema.parse({
        edits: [
          {
            id: 'shape-1',
            expectedVersion: 3,
            changes: { x: 100, strokeColor: '#111', locked: false }
          }
        ]
      })
    ).toMatchObject({ edits: [{ id: 'shape-1', expectedVersion: 3 }] })

    expect(
      editInputSchema.safeParse({
        edits: [{ id: 'shape-1', expectedVersion: 3, changes: {} }]
      }).success
    ).toBe(false)
    expect(
      editInputSchema.safeParse({
        edits: [
          { id: 'shape-1', expectedVersion: 3, changes: { opacity: 50 } },
          { id: 'shape-1', expectedVersion: 3, changes: { opacity: 75 } }
        ]
      }).success
    ).toBe(false)
    expect(
      editInputSchema.safeParse({
        edits: [{ id: 'shape-1', expectedVersion: 3, changes: { opacity: 101 } }]
      }).success
    ).toBe(false)
  })

  it('requires clear payloads to be empty objects', () => {
    expect(clearInputSchema.safeParse({}).success).toBe(true)
    expect(clearInputSchema.safeParse({ extra: true }).success).toBe(false)
  })

  it('defaults and validates structural editing verbs', () => {
    // Selection fallback: omitting `elements` stays valid and un-versioned.
    expect(groupInputSchema.parse({ operation: 'group' })).toEqual({ operation: 'group' })
    expect(groupInputSchema.safeParse({ operation: 'merge' }).success).toBe(false)
    expect(alignInputSchema.parse({ axis: 'y', position: 'center' })).toEqual({
      axis: 'y',
      position: 'center'
    })
    expect(stackInputSchema.parse({ direction: 'horizontal' })).toMatchObject({
      spacing: 20,
      align: 'center'
    })
    expect(orderInputSchema.safeParse({ operation: 'front' }).success).toBe(true)
    expect(orderInputSchema.safeParse({ operation: 'sideways' }).success).toBe(false)
    expect(distributeInputSchema.safeParse({ axis: 'z' }).success).toBe(false)
    // duplicate/delete are always explicit + versioned.
    expect(
      duplicateInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        expectedSceneVersion: 5
      })
    ).toMatchObject({ offset: { x: 10, y: 10 } })
    expect(duplicateInputSchema.safeParse({ elements: [], expectedSceneVersion: 5 }).success).toBe(
      false
    )
    expect(
      duplicateInputSchema.safeParse({ elements: [{ id: 'a', expectedVersion: 1 }] }).success
    ).toBe(false)
    expect(
      deleteInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        expectedSceneVersion: 5
      })
    ).toMatchObject({ includeRelated: false })
    expect(
      deleteInputSchema.safeParse({
        elements: [
          { id: 'a', expectedVersion: 1 },
          { id: 'a', expectedVersion: 2 }
        ],
        expectedSceneVersion: 5
      }).success
    ).toBe(false)
  })

  it('versions explicit structural operands by default', () => {
    // Explicit elements require a per-element expectedVersion AND expectedSceneVersion.
    expect(
      alignInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        axis: 'x',
        position: 'start'
      }).success
    ).toBe(false)
    expect(
      alignInputSchema.safeParse({
        elements: [{ id: 'a' }],
        axis: 'x',
        position: 'start',
        expectedSceneVersion: 3
      }).success
    ).toBe(false)
    expect(
      alignInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        axis: 'x',
        position: 'start',
        expectedSceneVersion: 3
      }).success
    ).toBe(true)
    // single-element explicit align is allowed by the schema (handled as a no-op)
    expect(
      orderInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 1 }],
        operation: 'front'
      }).success
    ).toBe(false)
  })

  it('requires versioned, non-empty transform geometry changes', () => {
    expect(
      transformInputSchema.parse({
        elements: [{ id: 'a', expectedVersion: 2, move: { dx: 5, dy: -5 } }]
      })
    ).toMatchObject({ elements: [{ id: 'a', expectedVersion: 2 }] })
    expect(
      transformInputSchema.safeParse({ elements: [{ id: 'a', expectedVersion: 2 }] }).success
    ).toBe(false)
    expect(
      transformInputSchema.safeParse({
        elements: [{ id: 'a', expectedVersion: 2, resize: {} }]
      }).success
    ).toBe(false)
    expect(
      transformInputSchema.safeParse({
        elements: [
          { id: 'a', expectedVersion: 1, move: { dx: 1, dy: 1 } },
          { id: 'a', expectedVersion: 1, move: { dx: 2, dy: 2 } }
        ]
      }).success
    ).toBe(false)
  })

  it('uses an independently owned app contract version', () => {
    expect(EXCALIDRAW_PROTOCOL_VERSION).toBe(4)
  })

  it('defines input and result contracts for every advertised verb', () => {
    expect(Object.keys(excalidrawVerbContracts)).toEqual(EXCALIDRAW_VERBS)
    expect(EXCALIDRAW_VERBS).toEqual([
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
      'transform'
    ])
    expect(
      excalidrawVerbContracts.draw.resultSchema.safeParse({
        ok: true,
        drawn: 2,
        replaced: false,
        connectors: []
      }).success
    ).toBe(true)
    expect(excalidrawVerbContracts.clear.resultSchema.safeParse({ ok: false }).success).toBe(false)
  })

  it('rejects impossible discriminated element records', () => {
    const common = {
      id: 'a',
      version: 1,
      zIndex: 0,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      angleDegrees: 0,
      style: {
        strokeColor: '#000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100
      },
      locked: false,
      groupIds: [],
      frameId: null,
      link: null,
      boundElements: [],
      capabilities: { editableFields: ['locked'], requiresUnlock: false, restrictions: [] }
    }
    expect(
      readElementSchema.safeParse({
        ...common,
        kind: 'text',
        type: 'text',
        linear: { points: [], startBinding: null, endBinding: null }
      }).success
    ).toBe(false)
    expect(
      readElementSchema.safeParse({
        ...common,
        kind: 'unsupported',
        type: 'laser',
        unsupportedType: 'laser'
      }).success
    ).toBe(true)
  })
})
