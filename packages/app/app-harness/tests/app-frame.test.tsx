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

vi.mock('@tinytinkerer/app-bridge', () => ({
  BridgeVersionMismatchError: bridgeMock.BridgeVersionMismatchError,
  iframeClientTransport: () => ({ post: () => {}, subscribe: () => () => {} }),
  createBridgeClient: () => ({
    ready: bridgeMock.ready,
    request: vi.fn(),
    on: vi.fn(() => () => {}),
    dispose: bridgeMock.dispose
  })
}))

import { AppFrame } from '../src/app-frame'
import { createAppBridgeHandle } from '../src/bridge-handle'

afterEach(() => {
  cleanup()
  bridgeMock.dispose.mockClear()
})

describe('AppFrame', () => {
  it('renders a script-only sandboxed iframe with the session nonce in the fragment', () => {
    const handle = createAppBridgeHandle()
    const { container } = render(
      <AppFrame
        src="/excalidraw-app/"
        appId="excalidraw"
        protocolVersion={1}
        expectedVerbs={['draw']}
        handle={handle}
        title="Excalidraw"
      />
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.getAttribute('src')).toMatch(/^\/excalidraw-app\/#app-bridge-nonce=/)
  })

  it('populates the handle and reports ready on a successful handshake', async () => {
    bridgeMock.ready = Promise.resolve({ appId: 'excalidraw', protocolVersion: 1, verbs: ['draw'] })
    const handle = createAppBridgeHandle()
    const onStatusChange = vi.fn()
    render(
      <AppFrame
        src="/excalidraw-app/"
        appId="excalidraw"
        protocolVersion={1}
        expectedVerbs={['draw']}
        handle={handle}
        title="Excalidraw"
        onStatusChange={onStatusChange}
      />
    )
    await waitFor(() => expect(handle.getStatus()).toBe('ready'))
    expect(onStatusChange).toHaveBeenCalledWith('ready')
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
        protocolVersion={1}
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
})
