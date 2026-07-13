// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Control the bridge client the AppFrame creates, without a real iframe/postMessage.
const bridgeMock = vi.hoisted(() => {
  class BridgeVersionMismatchError extends Error {
    readonly expected: number
    readonly received: number
    constructor(expected: number, received: number) {
      super(`mismatch ${expected}/${received}`)
      this.name = 'BridgeVersionMismatchError'
      this.expected = expected
      this.received = received
    }
  }
  return {
    BridgeVersionMismatchError,
    // Reassigned per test to drive the ready outcome.
    ready: Promise.resolve<unknown>(undefined),
    dispose: vi.fn()
  }
})

const clientMock = vi.hoisted(() => ({
  request: vi.fn<(verb: string, payload?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(null)
  ),
  on: vi.fn<(verb: string, handler: (payload: unknown) => void) => () => void>(() => () => {})
}))

vi.mock('@tinytinkerer/app-bridge', () => ({
  APP_SNAPSHOT_EVENT: 'app:snapshot',
  APP_SNAPSHOT_RESTORE_VERB: 'app:restore',
  BridgeVersionMismatchError: bridgeMock.BridgeVersionMismatchError,
  AppProtocolVersionMismatchError: bridgeMock.BridgeVersionMismatchError,
  iframeClientTransport: () => ({ post: () => {}, subscribe: () => () => {} }),
  createBridgeClient: () => ({
    ready: bridgeMock.ready,
    request: clientMock.request,
    on: clientMock.on,
    dispose: bridgeMock.dispose
  })
}))

import { AppFrame } from '../src/app-frame'
import { createAppBridgeHandle } from '../src/bridge-handle'

afterEach(() => {
  cleanup()
  bridgeMock.dispose.mockClear()
  clientMock.request.mockClear()
  clientMock.on.mockClear()
  window.localStorage.clear()
})

describe('AppFrame', () => {
  it('sandboxes the iframe with exactly the capabilities its features need', () => {
    const handle = createAppBridgeHandle()
    const { container } = render(
      <AppFrame
        src="/excalidraw-app/"
        appId="excalidraw"
        appProtocolVersion={2}
        expectedVerbs={['draw']}
        handle={handle}
        title="Excalidraw"
      />
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    // Downloads (export), popups + escape (external links), but deliberately NOT
    // allow-same-origin — that would collapse the opaque origin and defeat isolation.
    expect(iframe?.getAttribute('sandbox')).toBe(
      'allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox'
    )
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')
    // Permissions Policy delegation for the Clipboard API (copy/paste).
    expect(iframe?.getAttribute('allow')).toBe('clipboard-write; clipboard-read')
    expect(iframe?.getAttribute('src')).toMatch(/^\/excalidraw-app\/#app-bridge-nonce=/)
  })

  it('populates the handle and reports ready on a successful handshake', async () => {
    bridgeMock.ready = Promise.resolve({
      appId: 'excalidraw',
      protocolVersion: 2,
      appProtocolVersion: 2,
      verbs: ['draw']
    })
    const handle = createAppBridgeHandle()
    const onStatusChange = vi.fn()
    render(
      <AppFrame
        src="/excalidraw-app/"
        appId="excalidraw"
        appProtocolVersion={2}
        expectedVerbs={['draw']}
        handle={handle}
        title="Excalidraw"
        onStatusChange={onStatusChange}
      />
    )
    await waitFor(() => expect(handle.getStatus()).toBe('ready'))
    // The frame reports 'loading' while the handshake is in flight, then 'ready'.
    expect(onStatusChange).toHaveBeenCalledWith('loading')
    expect(onStatusChange).toHaveBeenLastCalledWith('ready')
  })

  it('degrades to version-mismatch and marks the handle unavailable', async () => {
    bridgeMock.ready = Promise.reject(new bridgeMock.BridgeVersionMismatchError(1, 2))
    bridgeMock.ready.catch(() => {})
    const handle = createAppBridgeHandle()
    const onStatusChange = vi.fn()
    render(
      <AppFrame
        src="/excalidraw-app/"
        appId="excalidraw"
        appProtocolVersion={2}
        expectedVerbs={['draw']}
        handle={handle}
        title="Excalidraw"
        onStatusChange={onStatusChange}
      />
    )
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('version-mismatch'))
    expect(handle.getStatus()).toBe('unavailable')
    await expect(handle.request('draw')).rejects.toThrow(/unavailable/)
  })

  const readyHandshake = (): void => {
    bridgeMock.ready = Promise.resolve({
      appId: 'excalidraw',
      protocolVersion: 2,
      appProtocolVersion: 2,
      verbs: ['draw']
    })
  }

  it('replays a persisted snapshot and saves emitted ones when persistenceKey is set', async () => {
    readyHandshake()
    const saved = { version: 1, elements: [{ id: 'a' }] }
    window.localStorage.setItem('canvas-scene', JSON.stringify(saved))
    const handle = createAppBridgeHandle()
    render(
      <AppFrame
        src="/excalidraw-app/"
        appId="excalidraw"
        appProtocolVersion={2}
        expectedVerbs={['draw']}
        handle={handle}
        title="Excalidraw"
        persistenceKey="canvas-scene"
      />
    )
    await waitFor(() => expect(handle.getStatus()).toBe('ready'))

    // Restore: the stored snapshot is replayed into the app.
    expect(clientMock.request).toHaveBeenCalledWith('app:restore', saved)
    // Save: the app's snapshot events are persisted under the key.
    expect(clientMock.on).toHaveBeenCalledWith('app:snapshot', expect.any(Function))
    const persist = clientMock.on.mock.calls.find(([verb]) => verb === 'app:snapshot')?.[1]
    persist?.({ version: 1, elements: [{ id: 'b' }] })
    expect(JSON.parse(window.localStorage.getItem('canvas-scene') ?? 'null')).toEqual({
      version: 1,
      elements: [{ id: 'b' }]
    })
  })

  it('does not touch storage or restore when persistenceKey is absent', async () => {
    readyHandshake()
    window.localStorage.setItem('canvas-scene', JSON.stringify({ version: 1, elements: [] }))
    const handle = createAppBridgeHandle()
    render(
      <AppFrame
        src="/excalidraw-app/"
        appId="excalidraw"
        appProtocolVersion={2}
        expectedVerbs={['draw']}
        handle={handle}
        title="Excalidraw"
      />
    )
    await waitFor(() => expect(handle.getStatus()).toBe('ready'))
    expect(clientMock.request).not.toHaveBeenCalled()
    expect(clientMock.on).not.toHaveBeenCalledWith('app:snapshot', expect.any(Function))
  })
})
