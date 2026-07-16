import { describe, expect, it } from 'vitest'
import {
  PIXEL_AGENTS_BRIDGE_CHANNEL,
  createPixelBootstrapMessages,
  parsePixelAgentsBootstrap,
  parsePixelClientEnvelope
} from '../src/protocol'

const bootstrap = parsePixelAgentsBootstrap({
  integrationVersion: 1,
  upstream: { commit: 'a'.repeat(40), version: '1.3.0' },
  assets: {
    characters: [],
    pets: [],
    petNames: [],
    floors: [],
    walls: [],
    furnitureCatalog: [],
    furnitureSprites: {}
  },
  defaultLayout: { version: 1 }
})

const envelope = (payload: string): unknown => ({
  channel: PIXEL_AGENTS_BRIDGE_CHANNEL,
  direction: 'client',
  payload
})

describe('Pixel Agents bridge protocol', () => {
  it('rejects malformed and wrong-channel envelopes', () => {
    expect(
      parsePixelClientEnvelope({ channel: 'other', direction: 'client', payload: '{}' })
    ).toBeNull()
    expect(parsePixelClientEnvelope(envelope('{bad'))).toBeNull()
  })

  it('never throws on a malformed client envelope, returning null instead', () => {
    expect(parsePixelClientEnvelope(null)).toBeNull()
    expect(parsePixelClientEnvelope('not an object')).toBeNull()
    expect(parsePixelClientEnvelope({ channel: PIXEL_AGENTS_BRIDGE_CHANNEL })).toBeNull()
    expect(parsePixelClientEnvelope(envelope('null'))).toBeNull()
    expect(parsePixelClientEnvelope(envelope('{"type":"unknownMessage"}'))).toBeNull()
  })

  it('parses a webviewReady message', () => {
    expect(parsePixelClientEnvelope(envelope('{"type":"webviewReady"}'))).toEqual({
      type: 'webviewReady'
    })
  })

  it('passes an arbitrary saveLayout layout through verbatim', () => {
    expect(
      parsePixelClientEnvelope(
        envelope(JSON.stringify({ type: 'saveLayout', layout: { rooms: [{ x: 1 }] } }))
      )
    ).toEqual({ type: 'saveLayout', layout: { rooms: [{ x: 1 }] } })
    expect(
      parsePixelClientEnvelope(envelope(JSON.stringify({ type: 'saveLayout', layout: 'nope' })))
    ).toBeNull()
  })

  it('accepts a saveAgentSeats message with a nullable seatId', () => {
    expect(
      parsePixelClientEnvelope(
        envelope(
          JSON.stringify({
            type: 'saveAgentSeats',
            seats: { '1': { palette: 2, hueShift: 10, seatId: null } }
          })
        )
      )
    ).toEqual({
      type: 'saveAgentSeats',
      seats: { '1': { palette: 2, hueShift: 10, seatId: null } }
    })
    expect(
      parsePixelClientEnvelope(
        envelope(
          JSON.stringify({
            type: 'saveAgentSeats',
            seats: { '1': { palette: 2, hueShift: 10, seatId: 'desk-a' } }
          })
        )
      )
    ).toEqual({
      type: 'saveAgentSeats',
      seats: { '1': { palette: 2, hueShift: 10, seatId: 'desk-a' } }
    })
  })

  it('rejects saveAgentSeats when any seat record is unknown-shaped', () => {
    expect(
      parsePixelClientEnvelope(
        envelope(
          JSON.stringify({
            type: 'saveAgentSeats',
            seats: { '1': { palette: '2', hueShift: 10, seatId: null } }
          })
        )
      )
    ).toBeNull()
    expect(
      parsePixelClientEnvelope(
        envelope(
          JSON.stringify({
            type: 'saveAgentSeats',
            seats: { '1': { palette: 2, hueShift: 10, seatId: 42 } }
          })
        )
      )
    ).toBeNull()
  })

  it('parses launchAgent, tolerating upstream-only optional fields', () => {
    expect(parsePixelClientEnvelope(envelope('{"type":"launchAgent"}'))).toEqual({
      type: 'launchAgent'
    })
    expect(
      parsePixelClientEnvelope(
        envelope(
          JSON.stringify({
            type: 'launchAgent',
            folderPath: '/workspace/two',
            bypassPermissions: true
          })
        )
      )
    ).toEqual({
      type: 'launchAgent',
      folderPath: '/workspace/two',
      bypassPermissions: true
    })
  })

  it('parses focusAgent and closeAgent', () => {
    expect(parsePixelClientEnvelope(envelope('{"type":"focusAgent","id":2}'))).toEqual({
      type: 'focusAgent',
      id: 2
    })
    expect(parsePixelClientEnvelope(envelope('{"type":"closeAgent","id":3}'))).toEqual({
      type: 'closeAgent',
      id: 3
    })
    expect(parsePixelClientEnvelope(envelope('{"type":"focusAgent"}'))).toBeNull()
  })

  it('throws Unsupported for a wrong or missing integration version', () => {
    expect(() => parsePixelAgentsBootstrap(null)).toThrow('Unsupported Pixel Agents bootstrap data')
    expect(() => parsePixelAgentsBootstrap({ integrationVersion: 2 })).toThrow(
      'Unsupported Pixel Agents bootstrap data'
    )
    expect(() => parsePixelAgentsBootstrap({})).toThrow('Unsupported Pixel Agents bootstrap data')
  })

  it('throws Invalid for a shape violation once the version matches', () => {
    expect(() =>
      parsePixelAgentsBootstrap({ integrationVersion: 1, upstream: { commit: 'a' } })
    ).toThrow('Invalid Pixel Agents bootstrap data')
  })

  it('loads the agents before the layout so upstream can assign desks', () => {
    const messages = createPixelBootstrapMessages(
      bootstrap,
      null,
      [{ agentId: 1, title: 'TinyTinkerer', isRunning: false, awaitingInput: true }],
      { 1: { palette: 2 } },
      1
    )
    const types = messages.map((message) => message.type)
    expect(types.indexOf('existingAgents')).toBeLessThan(types.indexOf('layoutLoaded'))
    expect(messages).toContainEqual({
      type: 'existingAgents',
      agents: [1],
      agentMeta: { '1': { palette: 2 } },
      folderNames: { '1': 'TinyTinkerer' },
      externalAgents: { '1': false }
    })
    expect(messages.at(-1)).toEqual({
      type: 'agentStatus',
      id: 1,
      status: 'waiting',
      awaitingInput: true
    })
  })

  it('emits one existingAgents entry and one agentStatus per agent, and agentSelected for the active one', () => {
    const messages = createPixelBootstrapMessages(
      bootstrap,
      null,
      [
        { agentId: 1, title: 'First conversation', isRunning: true, awaitingInput: false },
        { agentId: 2, title: 'Second conversation', isRunning: false, awaitingInput: true }
      ],
      {},
      2
    )
    expect(messages).toContainEqual({
      type: 'existingAgents',
      agents: [1, 2],
      agentMeta: {},
      folderNames: { '1': 'First conversation', '2': 'Second conversation' },
      externalAgents: { '1': false, '2': false }
    })
    expect(messages).toContainEqual({ type: 'agentSelected', id: 2 })
    expect(messages).toContainEqual({ type: 'agentStatus', id: 1, status: 'active' })
    expect(messages).toContainEqual({
      type: 'agentStatus',
      id: 2,
      status: 'waiting',
      awaitingInput: true
    })
  })

  it('omits agentSelected when there is no active agent', () => {
    const messages = createPixelBootstrapMessages(
      bootstrap,
      null,
      [{ agentId: 1, title: 'TinyTinkerer', isRunning: false, awaitingInput: true }],
      {},
      undefined
    )
    expect(messages.some((message) => message.type === 'agentSelected')).toBe(false)
  })
})
