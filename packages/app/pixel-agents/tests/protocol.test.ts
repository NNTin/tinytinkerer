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

describe('Pixel Agents bridge protocol', () => {
  it('rejects malformed and wrong-channel envelopes', () => {
    expect(
      parsePixelClientEnvelope({ channel: 'other', direction: 'client', payload: '{}' })
    ).toBeNull()
    expect(
      parsePixelClientEnvelope({
        channel: PIXEL_AGENTS_BRIDGE_CHANNEL,
        direction: 'client',
        payload: '{bad'
      })
    ).toBeNull()
  })

  it('loads the agent before the layout so upstream can assign a desk', () => {
    const messages = createPixelBootstrapMessages(bootstrap, null, { palette: 2 }, false, true)
    const types = messages.map((message) => message.type)
    expect(types.indexOf('existingAgents')).toBeLessThan(types.indexOf('layoutLoaded'))
    expect(messages.at(-1)).toEqual({
      type: 'agentStatus',
      id: 1,
      status: 'waiting',
      awaitingInput: true
    })
  })
})
