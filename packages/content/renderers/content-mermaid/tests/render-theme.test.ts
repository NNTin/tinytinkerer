// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockInitialize = vi.hoisted(() => vi.fn())
const mockRender = vi.hoisted(() => vi.fn())
const mockParse = vi.hoisted(() => vi.fn())

import { renderMermaidSource, resetMermaidState } from '../src/index.js'

afterEach(() => {
  resetMermaidState()
  delete window.mermaid
})

beforeEach(() => {
  mockInitialize.mockReset()
  mockRender.mockReset()
  mockParse.mockReset()
  mockParse.mockResolvedValue({ diagramType: 'flowchart' })
  mockRender.mockResolvedValue({ svg: '<svg></svg>' })
  window.mermaid = {
    initialize: mockInitialize,
    parse: mockParse,
    render: mockRender
  }
})

// Yields to the microtask queue until the given predicate is true. Everything
// under test here is promise-chained (no real timers), so plain microtask
// ticks are enough and stay deterministic.
const flushUntil = async (predicate: () => boolean, maxTicks = 1000): Promise<void> => {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('flushUntil: predicate never became true')
}

describe('renderMermaidSource theme handling', () => {
  it('initializes with the requested theme before rendering', async () => {
    await renderMermaidSource('graph TD\nA-->B', 'diagram-1', { theme: 'dark' })

    expect(mockInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
    )
    const lastInitializeOrder =
      mockInitialize.mock.invocationCallOrder[mockInitialize.mock.invocationCallOrder.length - 1]!
    const renderOrder = mockRender.mock.invocationCallOrder[0]!
    expect(lastInitializeOrder).toBeLessThan(renderOrder)
  })

  it('re-initializes back to default on a subsequent default render', async () => {
    await renderMermaidSource('graph TD\nA-->B', 'diagram-1', { theme: 'dark' })
    expect(mockInitialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))

    await renderMermaidSource('graph TD\nA-->B', 'diagram-2')

    expect(mockInitialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'default' }))
  })

  it('only initializes once across two default renders (the steady-state chat case)', async () => {
    await renderMermaidSource('graph TD\nA-->B', 'diagram-1')
    expect(mockInitialize).toHaveBeenCalledTimes(1)

    await renderMermaidSource('graph TD\nA-->B', 'diagram-2')

    expect(mockInitialize).toHaveBeenCalledTimes(1)
  })

  it('serializes interleaved renders so each one applies and renders under its own theme', async () => {
    const themeAtRenderCall: string[] = []
    let releaseFirstRender: (() => void) | undefined
    const firstRenderGate = new Promise<void>((resolve) => {
      releaseFirstRender = resolve
    })

    mockRender.mockImplementation(async () => {
      const lastConfig = mockInitialize.mock.calls[mockInitialize.mock.calls.length - 1]?.[0] as
        | { theme?: string }
        | undefined
      themeAtRenderCall.push(lastConfig?.theme ?? 'unknown')

      if (themeAtRenderCall.length === 1) {
        await firstRenderGate
      }

      return { svg: '<svg></svg>' }
    })

    const firstRender = renderMermaidSource('graph TD\nA-->B', 'diagram-default')
    // Let the default render reach the (now-gated) mermaid.render call before
    // starting the dark render.
    await flushUntil(() => mockRender.mock.calls.length === 1)

    const secondRender = renderMermaidSource('graph TD\nA-->B', 'diagram-dark', { theme: 'dark' })
    // Give the dark render's synchronous prelude (loadMermaidRuntime) a chance
    // to run; it must not jump the lock while the default render is pending.
    await Promise.resolve()
    await Promise.resolve()

    expect(mockRender).toHaveBeenCalledTimes(1)
    expect(mockInitialize).not.toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }))

    releaseFirstRender?.()
    await firstRender
    await secondRender

    expect(themeAtRenderCall).toEqual(['default', 'dark'])
  })

  it('does not let a new call clobber an in-flight dark render via the runtime fast path', async () => {
    const themeAtRenderCall: string[] = []
    let releaseFirstRender: (() => void) | undefined
    const firstRenderGate = new Promise<void>((resolve) => {
      releaseFirstRender = resolve
    })

    mockRender.mockImplementation(async () => {
      const lastConfig = mockInitialize.mock.calls[mockInitialize.mock.calls.length - 1]?.[0] as
        | { theme?: string }
        | undefined
      themeAtRenderCall.push(lastConfig?.theme ?? 'unknown')

      if (themeAtRenderCall.length === 1) {
        await firstRenderGate
      }

      return { svg: '<svg></svg>' }
    })

    const darkRender = renderMermaidSource('graph TD\nA-->B', 'diagram-dark', { theme: 'dark' })
    await flushUntil(() => mockRender.mock.calls.length === 1)

    // loadMermaidRuntime runs synchronously on this call's prelude; it must not
    // re-initialize to default while the dark render still holds the lock.
    const defaultRender = renderMermaidSource('graph TD\nA-->B', 'diagram-default')
    await Promise.resolve()
    await Promise.resolve()

    expect(mockInitialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))

    releaseFirstRender?.()
    await darkRender
    await defaultRender

    expect(themeAtRenderCall).toEqual(['dark', 'default'])
  })
})
