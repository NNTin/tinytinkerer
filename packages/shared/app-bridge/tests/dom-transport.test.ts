import { describe, expect, it, vi } from 'vitest'
import { iframeClientTransport, parentServerTransport } from '../src/dom-transport'

// Minimal fake of a Window's message-event surface so the identity filtering can
// be exercised without jsdom: addEventListener captures listeners, dispatch fires
// them, postMessage records calls.
const makeFakeWindow = () => {
  const listeners = new Set<(event: MessageEvent) => void>()
  const posted: unknown[] = []
  const win = {
    addEventListener: (_type: string, cb: (event: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (event: MessageEvent) => void) => listeners.delete(cb),
    postMessage: (message: unknown) => posted.push(message),
    dispatch: (event: { source: unknown; data: unknown }) => {
      for (const cb of [...listeners]) cb(event as unknown as MessageEvent)
    },
    posted,
    listenerCount: () => listeners.size
  }
  return win
}

describe('iframeClientTransport', () => {
  it('posts to the iframe contentWindow and only accepts messages from it', () => {
    const host = makeFakeWindow()
    const contentWindow = makeFakeWindow()
    const frame = { contentWindow: contentWindow as unknown as Window }
    const transport = iframeClientTransport(frame, { hostWindow: host as unknown as Window })

    transport.post({ hello: true })
    expect(contentWindow.posted).toEqual([{ hello: true }])

    const received: unknown[] = []
    const unsubscribe = transport.subscribe((m) => received.push(m))

    // From the iframe → accepted.
    host.dispatch({ source: frame.contentWindow, data: { ok: 1 } })
    // From some other window → rejected.
    host.dispatch({ source: makeFakeWindow(), data: { evil: true } })

    expect(received).toEqual([{ ok: 1 }])

    unsubscribe()
    expect(host.listenerCount()).toBe(0)
  })
})

describe('parentServerTransport', () => {
  it('posts to window.parent and only accepts messages from the parent', () => {
    const parent = makeFakeWindow()
    const appWindow = makeFakeWindow()
    ;(appWindow as unknown as { parent: unknown }).parent = parent

    const transport = parentServerTransport({ appWindow: appWindow as unknown as Window })

    transport.post({ ping: 1 })
    expect(parent.posted).toEqual([{ ping: 1 }])

    const received: unknown[] = []
    transport.subscribe((m) => received.push(m))

    appWindow.dispatch({ source: parent, data: { fromParent: true } })
    appWindow.dispatch({ source: makeFakeWindow(), data: { spoofed: true } })

    expect(received).toEqual([{ fromParent: true }])
  })
})

describe('dom-transport defaults', () => {
  it('falls back to the global window when none is injected', () => {
    const addSpy = vi.fn()
    vi.stubGlobal('window', {
      addEventListener: addSpy,
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      parent: { postMessage: vi.fn() }
    })
    try {
      const transport = parentServerTransport()
      transport.subscribe(() => {})
      expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function))
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
