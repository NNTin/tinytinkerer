import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { mediaRefFor } from '@tinytinkerer/contracts'
import { buildMediaRegistry } from '../src/media-registry.js'

// Minimal `agent.tool.completed` fixture — only the fields buildMediaRegistry
// reads (`type`, `payload.stepId`, `payload.output`) matter for these tests.
const toolCompleted = (stepId: string, output: unknown): ChatEvent => ({
  id: `evt-${stepId}`,
  timestamp: new Date().toISOString(),
  type: 'agent.tool.completed',
  payload: { stepId, toolId: 'some-tool', output }
})

describe('buildMediaRegistry', () => {
  it('resolves mediaRefFor(stepId, index) to the media item data URL', () => {
    const dataUrl = 'data:image/png;base64,abcd'
    const events = [
      toolCompleted('step-1', {
        media: [
          {
            kind: 'image',
            dataUrl,
            mimeType: 'image/png',
            width: 10,
            height: 10,
            description: 'A chart'
          }
        ]
      })
    ]

    const registry = buildMediaRegistry(events)

    expect(registry.get(mediaRefFor('step-1', 0))).toBe(dataUrl)
  })

  it('indexes multiple media items on the same event by their position', () => {
    const events = [
      toolCompleted('step-1', {
        media: [
          {
            kind: 'image',
            dataUrl: 'data:image/png;base64,first',
            mimeType: 'image/png',
            width: 10,
            height: 10,
            description: 'First'
          },
          {
            kind: 'image',
            dataUrl: 'data:image/png;base64,second',
            mimeType: 'image/png',
            width: 10,
            height: 10,
            description: 'Second'
          }
        ]
      })
    ]

    const registry = buildMediaRegistry(events)

    expect(registry.get(mediaRefFor('step-1', 0))).toBe('data:image/png;base64,first')
    expect(registry.get(mediaRefFor('step-1', 1))).toBe('data:image/png;base64,second')
  })

  it('returns undefined for an unknown ref', () => {
    const events = [
      toolCompleted('step-1', {
        media: [
          {
            kind: 'image',
            dataUrl: 'data:image/png;base64,abcd',
            mimeType: 'image/png',
            width: 10,
            height: 10,
            description: 'A chart'
          }
        ]
      })
    ]

    const registry = buildMediaRegistry(events)

    expect(registry.get(mediaRefFor('step-1', 1))).toBeUndefined()
    expect(registry.get(mediaRefFor('nope', 0))).toBeUndefined()
    expect(registry.get('not-a-media-ref')).toBeUndefined()
  })

  it('skips a malformed output without throwing', () => {
    const events = [
      toolCompleted('step-1', { media: 'not-an-array' }),
      toolCompleted('step-2', null),
      toolCompleted('step-3', 'a plain string'),
      toolCompleted('step-4', { media: [{ kind: 'image', dataUrl: 'missing-fields' }] })
    ]

    expect(() => buildMediaRegistry(events)).not.toThrow()
    const registry = buildMediaRegistry(events)
    expect(registry.size).toBe(0)
  })

  it('ignores non-tool-completed events and builds an empty registry from an empty list', () => {
    const events: ChatEvent[] = [
      {
        id: 'evt-1',
        timestamp: new Date().toISOString(),
        type: 'agent.tool.started',
        payload: { stepId: 'step-1', toolId: 'some-tool', input: {} }
      }
    ]

    expect(buildMediaRegistry(events).size).toBe(0)
    expect(buildMediaRegistry([]).size).toBe(0)
  })
})
