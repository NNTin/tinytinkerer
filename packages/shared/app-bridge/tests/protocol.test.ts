import { describe, expect, it } from 'vitest'
import { APP_BRIDGE_PROTOCOL_VERSION, bridgeMessageSchema } from '../src/protocol'

const base = { protocolVersion: APP_BRIDGE_PROTOCOL_VERSION, sessionNonce: 'n1' }

describe('bridgeMessageSchema', () => {
  it('accepts each well-formed message kind', () => {
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'req', id: '1', verb: 'draw', payload: {} })
        .success
    ).toBe(true)
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'res', id: '1', ok: true, result: 7 }).success
    ).toBe(true)
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'res', id: '1', ok: false, error: 'boom' })
        .success
    ).toBe(true)
    expect(
      bridgeMessageSchema.safeParse({
        ...base,
        kind: 'event',
        verb: 'scene-changed',
        payload: null
      }).success
    ).toBe(true)
    expect(
      bridgeMessageSchema.safeParse({
        ...base,
        kind: 'ready',
        appId: 'excalidraw',
        appProtocolVersion: 2,
        verbs: ['draw']
      }).success
    ).toBe(true)
  })

  it('rejects an unknown kind', () => {
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'nope', id: '1', verb: 'x', payload: 1 })
        .success
    ).toBe(false)
  })

  it('rejects messages missing the envelope base (nonce / version)', () => {
    expect(
      bridgeMessageSchema.safeParse({ kind: 'req', id: '1', verb: 'x', payload: 1 }).success
    ).toBe(false)
    expect(
      bridgeMessageSchema.safeParse({
        protocolVersion: 1,
        kind: 'req',
        id: '1',
        verb: 'x',
        payload: 1
      }).success
    ).toBe(false)
  })

  it('rejects a request missing required fields', () => {
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'req', verb: 'x', payload: 1 }).success
    ).toBe(false)
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'req', id: '1', payload: 1 }).success
    ).toBe(false)
  })

  it('rejects non-string / empty verbs and ids', () => {
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'req', id: '', verb: 'x', payload: 1 }).success
    ).toBe(false)
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'event', verb: '', payload: 1 }).success
    ).toBe(false)
  })

  it('enforces the response invariant (ok:false requires a non-empty error)', () => {
    // ok:false without an error — must be rejected, not interpreted with a fallback.
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'res', id: '1', ok: false }).success
    ).toBe(false)
    // ok:false with an empty error — still rejected.
    expect(
      bridgeMessageSchema.safeParse({ ...base, kind: 'res', id: '1', ok: false, error: '' }).success
    ).toBe(false)
    // ok:true needs no error and may omit result.
    expect(bridgeMessageSchema.safeParse({ ...base, kind: 'res', id: '1', ok: true }).success).toBe(
      true
    )
  })
})
