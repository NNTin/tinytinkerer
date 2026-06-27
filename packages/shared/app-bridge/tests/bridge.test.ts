import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BridgeCapabilityMismatchError,
  createBridgeClient,
  BridgeVersionMismatchError
} from '../src/client'
import { createBridgeServer, defineBridgeVerb } from '../src/server'
import type { BridgeTransport } from '../src/transport'
import { z } from 'zod'

// Two transports wired together in memory, delivering each message to the other
// side on a microtask (so the async hop mimics postMessage without a real iframe).
// structuredClone reproduces the serialization boundary postMessage imposes.
const createLinkedTransports = (): { harness: BridgeTransport; app: BridgeTransport } => {
  const harnessHandlers = new Set<(m: unknown) => void>()
  const appHandlers = new Set<(m: unknown) => void>()
  const deliver = (handlers: Set<(m: unknown) => void>, message: unknown): void => {
    const cloned = structuredClone(message)
    for (const handler of [...handlers]) queueMicrotask(() => handler(cloned))
  }
  return {
    harness: {
      post: (m) => deliver(appHandlers, m),
      subscribe: (h) => {
        harnessHandlers.add(h)
        return () => harnessHandlers.delete(h)
      }
    },
    app: {
      post: (m) => deliver(harnessHandlers, m),
      subscribe: (h) => {
        appHandlers.add(h)
        return () => appHandlers.delete(h)
      }
    }
  }
}

const NONCE = 'session-nonce'
const VERSION = 1

afterEach(() => {
  vi.useRealTimers()
})

describe('app-bridge client/server round-trip', () => {
  it('completes the handshake and resolves a verb result', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, {
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      expectedAppId: 'excalidraw'
    })
    createBridgeServer(app, {
      appId: 'excalidraw',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: {
        echo: (payload) => ({ echoed: payload })
      }
    })

    const handshake = await client.ready
    expect(handshake).toEqual({ appId: 'excalidraw', protocolVersion: VERSION, verbs: ['echo'] })

    await expect(client.request('echo', { a: 1 })).resolves.toEqual({ echoed: { a: 1 } })
    client.dispose()
  })

  it('rejects a request when the handler throws', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, { protocolVersion: VERSION, sessionNonce: NONCE })
    createBridgeServer(app, {
      appId: 'a',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: {
        boom: () => {
          throw new Error('handler exploded')
        }
      }
    })
    await client.ready
    await expect(client.request('boom')).rejects.toThrow('handler exploded')
  })

  it('validates a verb payload before invoking its handler', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, { protocolVersion: VERSION, sessionNonce: NONCE })
    const handler = vi.fn((payload: unknown) => payload)
    createBridgeServer(app, {
      appId: 'a',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: {
        draw: defineBridgeVerb(
          {
            inputSchema: z.object({ count: z.number().int().positive() }),
            resultSchema: z.object({ accepted: z.number() })
          },
          (payload) => {
            handler(payload)
            return { accepted: payload.count }
          }
        )
      }
    })
    await client.ready

    await expect(client.request('draw', { count: 2 })).resolves.toEqual({ accepted: 2 })
    await expect(client.request('draw', { count: 0 })).rejects.toThrow()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('rejects a handler result that violates the verb contract', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, { protocolVersion: VERSION, sessionNonce: NONCE })
    createBridgeServer(app, {
      appId: 'a',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: {
        draw: defineBridgeVerb(
          {
            inputSchema: z.object({}),
            resultSchema: z.object({ ok: z.literal(true) })
          },
          () => ({ ok: false as true })
        )
      }
    })
    await client.ready

    await expect(client.request('draw', {})).rejects.toThrow()
  })

  it('rejects a request for an unknown verb', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, { protocolVersion: VERSION, sessionNonce: NONCE })
    createBridgeServer(app, {
      appId: 'a',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: {}
    })
    await client.ready
    await expect(client.request('missing')).rejects.toThrow(/unknown verb "missing"/)
  })

  it('delivers app events to subscribers', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, { protocolVersion: VERSION, sessionNonce: NONCE })
    const server = createBridgeServer(app, {
      appId: 'a',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: {}
    })
    await client.ready

    const received: unknown[] = []
    const off = client.on('scene-changed', (payload) => received.push(payload))
    server.emit('scene-changed', { count: 3 })
    await Promise.resolve()
    await Promise.resolve()
    expect(received).toEqual([{ count: 3 }])

    off()
    server.emit('scene-changed', { count: 4 })
    await Promise.resolve()
    await Promise.resolve()
    expect(received).toEqual([{ count: 3 }])
  })

  it('rejects ready on a protocol version mismatch', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, { protocolVersion: 1, sessionNonce: NONCE })
    createBridgeServer(app, {
      appId: 'a',
      protocolVersion: 2,
      sessionNonce: NONCE,
      handlers: {}
    })
    await expect(client.ready).rejects.toBeInstanceOf(BridgeVersionMismatchError)
  })

  it('rejects ready when the appId does not match expectedAppId', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, {
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      expectedAppId: 'excalidraw'
    })
    createBridgeServer(app, {
      appId: 'someone-else',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: {}
    })
    await expect(client.ready).rejects.toThrow(/unexpected appId "someone-else"/)
  })

  it('rejects ready when the app omits a required verb', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, {
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      expectedVerbs: ['draw', 'read']
    })
    createBridgeServer(app, {
      appId: 'a',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: { draw: (payload) => payload }
    })

    await expect(client.ready).rejects.toBeInstanceOf(BridgeCapabilityMismatchError)
    await expect(client.ready).rejects.toMatchObject({
      name: 'BridgeCapabilityMismatchError',
      missingVerbs: ['read']
    })
  })

  it('ignores messages stamped with a different session nonce', async () => {
    const { harness, app } = createLinkedTransports()
    const client = createBridgeClient(harness, { protocolVersion: VERSION, sessionNonce: 'mine' })
    // Server speaks a different nonce — its ready/replies must be ignored.
    createBridgeServer(app, {
      appId: 'a',
      protocolVersion: VERSION,
      sessionNonce: 'theirs',
      handlers: { echo: (p) => p }
    })

    let readyResolved = false
    void client.ready.then(() => {
      readyResolved = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(readyResolved).toBe(false)
  })

  it('re-announces ready to a client that subscribes after the app started (hello)', async () => {
    const { harness, app } = createLinkedTransports()
    // App starts first and announces ready into the void (no client yet).
    createBridgeServer(app, {
      appId: 'excalidraw',
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      handlers: { echo: (p) => p }
    })
    await Promise.resolve()
    await Promise.resolve()

    // A client that attaches afterwards posts `hello` on creation and must still
    // receive a fresh `ready` (mirrors a React strict-mode effect re-run).
    const client = createBridgeClient(harness, {
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      expectedAppId: 'excalidraw'
    })
    await expect(client.ready).resolves.toMatchObject({ appId: 'excalidraw' })
    client.dispose()
  })

  it('times out a request that never gets a response', async () => {
    vi.useFakeTimers()
    // A transport that drops everything — the app never replies.
    const deadTransport: BridgeTransport = {
      post: () => {},
      subscribe: () => () => {}
    }
    const client = createBridgeClient(deadTransport, {
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      timeoutMs: 1000
    })
    const pending = client.request('draw', {})
    const assertion = expect(pending).rejects.toThrow(/timed out after 1000ms/)
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('rejects in-flight requests when disposed', async () => {
    const deadTransport: BridgeTransport = {
      post: () => {},
      subscribe: () => () => {}
    }
    const client = createBridgeClient(deadTransport, {
      protocolVersion: VERSION,
      sessionNonce: NONCE,
      timeoutMs: 60_000
    })
    const pending = client.request('draw', {})
    const assertion = expect(pending).rejects.toThrow(/disposed/)
    client.dispose()
    await assertion
  })
})
