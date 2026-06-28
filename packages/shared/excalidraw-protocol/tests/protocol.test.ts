import { describe, expect, it } from 'vitest'
import {
  clearInputSchema,
  drawInputSchema,
  editInputSchema,
  excalidrawVerbContracts,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_VERBS,
  inspectInputSchema,
  readInputSchema,
  searchInputSchema
} from '../src/index'

describe('excalidraw protocol', () => {
  it('accepts the model-facing draw vocabulary', () => {
    expect(
      drawInputSchema.parse({
        elements: [
          { type: 'rectangle', x: 10, y: 20, width: 120, height: 80, text: 'Start' },
          { type: 'arrow', x: 130, y: 60, strokeColor: '#111' }
        ],
        replace: true
      })
    ).toMatchObject({ replace: true })
  })

  it('rejects empty, unknown, and malformed draw elements', () => {
    expect(drawInputSchema.safeParse({ elements: [] }).success).toBe(false)
    expect(drawInputSchema.safeParse({ elements: [{ type: 'image', x: 0, y: 0 }] }).success).toBe(
      false
    )
    expect(
      drawInputSchema.safeParse({ elements: [{ type: 'text', x: Number.NaN, y: 0 }] }).success
    ).toBe(false)
  })

  it('defaults and bounds candidate search', () => {
    expect(searchInputSchema.parse({})).toEqual({ scope: 'all', limit: 20 })
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

  it('uses the shared bridge protocol version', () => {
    expect(EXCALIDRAW_PROTOCOL_VERSION).toBe(1)
  })

  it('defines input and result contracts for every advertised verb', () => {
    expect(Object.keys(excalidrawVerbContracts)).toEqual(EXCALIDRAW_VERBS)
    expect(EXCALIDRAW_VERBS).toEqual(['draw', 'search', 'inspect', 'read', 'edit', 'clear'])
    expect(
      excalidrawVerbContracts.draw.resultSchema.safeParse({
        ok: true,
        drawn: 2,
        replaced: false
      }).success
    ).toBe(true)
    expect(excalidrawVerbContracts.clear.resultSchema.safeParse({ ok: false }).success).toBe(false)
  })
})
