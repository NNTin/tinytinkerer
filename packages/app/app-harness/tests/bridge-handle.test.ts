import { describe, expect, it, vi } from 'vitest'
import type { BridgeClient } from '@tinytinkerer/app-bridge'
import { createAppBridgeHandle } from '../src/bridge-handle'

const fakeClient = (request = vi.fn().mockResolvedValue('ok')): BridgeClient => ({
  ready: Promise.resolve({ appId: 'a', protocolVersion: 1, verbs: [] }),
  request,
  on: vi.fn(() => () => {}),
  dispose: vi.fn()
})

describe('createAppBridgeHandle', () => {
  it('starts pending and rejects requests until a client is set', async () => {
    const handle = createAppBridgeHandle()
    expect(handle.getStatus()).toBe('pending')
    await expect(handle.request('draw', {})).rejects.toThrow(/before the app finishes loading/)
  })

  it('forwards requests to the client once ready', async () => {
    const handle = createAppBridgeHandle()
    const request = vi.fn().mockResolvedValue('ok')
    handle.setClient(fakeClient(request))
    expect(handle.getStatus()).toBe('ready')
    await expect(handle.request('draw', { n: 1 })).resolves.toBe('ok')
    expect(request).toHaveBeenCalledWith('draw', { n: 1 })
  })

  it('returns to pending when the client is cleared (teardown)', async () => {
    const handle = createAppBridgeHandle()
    handle.setClient(fakeClient())
    handle.setClient(null)
    expect(handle.getStatus()).toBe('pending')
    await expect(handle.request('draw')).rejects.toThrow(/before the app finishes loading/)
  })

  it('rejects with the reason once marked unavailable', async () => {
    const handle = createAppBridgeHandle()
    handle.setUnavailable('protocol version mismatch')
    expect(handle.getStatus()).toBe('unavailable')
    await expect(handle.request('draw')).rejects.toThrow(/unavailable — protocol version mismatch/)
  })
})
