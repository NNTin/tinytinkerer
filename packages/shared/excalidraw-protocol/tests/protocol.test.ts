import { describe, expect, it } from 'vitest'
import {
  alignInputSchema,
  clearInputSchema,
  deleteInputSchema,
  distributeInputSchema,
  duplicateInputSchema,
  drawInputSchema,
  editInputSchema,
  excalidrawVerbContracts,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_VERBS,
  groupInputSchema,
  inspectInputSchema,
  readInputSchema,
  readElementSchema,
  reorderInputSchema,
  searchInputSchema,
  stackInputSchema,
  ungroupInputSchema
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
        expectedSceneVersion: 10,
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

  it('defines versioned structural editing inputs', () => {
    const refs = [
      { id: 'a', expectedVersion: 1 },
      { id: 'b', expectedVersion: 2 },
      { id: 'c', expectedVersion: 3 }
    ]
    expect(
      groupInputSchema.parse({ expectedSceneVersion: 6, elements: refs.slice(0, 2) })
    ).toMatchObject({ expectedSceneVersion: 6, elements: refs.slice(0, 2) })
    expect(
      groupInputSchema.safeParse({ expectedSceneVersion: 6, elements: refs.slice(0, 1) }).success
    ).toBe(false)
    expect(
      ungroupInputSchema.parse({ expectedSceneVersion: 6, elements: refs.slice(0, 1) })
    ).toMatchObject({ mode: 'innermost' })
    expect(
      duplicateInputSchema.parse({ expectedSceneVersion: 6, elements: refs.slice(0, 1) })
    ).toMatchObject({ offsetX: 20, offsetY: 20, includeRelated: true })
    expect(
      deleteInputSchema.parse({ expectedSceneVersion: 6, elements: refs.slice(0, 1) })
    ).toMatchObject({ includeRelated: false })
    expect(
      alignInputSchema.parse({
        expectedSceneVersion: 6,
        elements: refs.slice(0, 1),
        axis: 'x',
        position: 'center'
      })
    ).toMatchObject({ position: 'center' })
    expect(
      distributeInputSchema.parse({
        expectedSceneVersion: 6,
        elements: refs.slice(0, 1),
        axis: 'y'
      })
    ).toMatchObject({ axis: 'y' })
    expect(
      stackInputSchema.parse({ expectedSceneVersion: 6, elements: refs, axis: 'x' })
    ).toMatchObject({ spacing: 20, order: 'input' })
    expect(
      reorderInputSchema.parse({
        expectedSceneVersion: 6,
        elements: refs.slice(0, 1),
        direction: 'front'
      })
    ).toMatchObject({ direction: 'front' })
    expect(
      alignInputSchema.safeParse({
        expectedSceneVersion: 6,
        elements: [refs[0], refs[0]],
        axis: 'x',
        position: 'start'
      }).success
    ).toBe(false)
  })

  it('requires clear payloads to be empty objects', () => {
    expect(clearInputSchema.safeParse({}).success).toBe(true)
    expect(clearInputSchema.safeParse({ extra: true }).success).toBe(false)
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
      'group',
      'ungroup',
      'duplicate',
      'delete',
      'align',
      'distribute',
      'stack',
      'reorder',
      'clear'
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
