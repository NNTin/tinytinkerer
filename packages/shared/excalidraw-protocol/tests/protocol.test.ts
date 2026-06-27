import { describe, expect, it } from 'vitest'
import {
  clearInputSchema,
  drawInputSchema,
  excalidrawVerbContracts,
  EXCALIDRAW_PROTOCOL_VERSION,
  EXCALIDRAW_VERBS,
  readInputSchema
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

  it('requires read and clear payloads to be empty objects', () => {
    expect(readInputSchema.safeParse({}).success).toBe(true)
    expect(clearInputSchema.safeParse({ extra: true }).success).toBe(false)
  })

  it('uses the shared bridge protocol version', () => {
    expect(EXCALIDRAW_PROTOCOL_VERSION).toBe(1)
  })

  it('defines input and result contracts for every advertised verb', () => {
    expect(Object.keys(excalidrawVerbContracts)).toEqual(EXCALIDRAW_VERBS)
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
