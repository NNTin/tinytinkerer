import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIXEL_AGENTS_NARROW_VIEWPORT_QUERY, PIXEL_AGENTS_REDUCED_MOTION_QUERY } from '../constants'
import { usePixelAgentsCapability } from '../capability'

type Listener = () => void

// A minimal, controllable matchMedia stand-in: each query gets its own
// listener set, and `setMatches` below drives change events the same way a
// real browser would when the viewport crosses a breakpoint or the OS-level
// reduced-motion preference toggles.
const createMatchMediaStub = () => {
  const state = new Map<string, boolean>()
  const listeners = new Map<string, Set<Listener>>()

  const matchMedia = (query: string): MediaQueryList => {
    if (!state.has(query)) state.set(query, false)
    if (!listeners.has(query)) listeners.set(query, new Set())
    return {
      get matches() {
        return state.get(query) ?? false
      },
      media: query,
      addEventListener: (_event: string, listener: Listener) => {
        listeners.get(query)?.add(listener)
      },
      removeEventListener: (_event: string, listener: Listener) => {
        listeners.get(query)?.delete(listener)
      }
    } as unknown as MediaQueryList
  }

  const setMatches = (query: string, matches: boolean): void => {
    state.set(query, matches)
    for (const listener of listeners.get(query) ?? []) listener()
  }

  return { matchMedia, setMatches }
}

describe('usePixelAgentsCapability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('allows the graphical office when nothing disqualifies it', () => {
    const { matchMedia } = createMatchMediaStub()
    vi.stubGlobal('matchMedia', matchMedia)

    const { result } = renderHook(() => usePixelAgentsCapability(false))
    expect(result.current).toBe(true)
  })

  it('disallows the graphical office on a narrow viewport', () => {
    const { matchMedia, setMatches } = createMatchMediaStub()
    vi.stubGlobal('matchMedia', matchMedia)
    setMatches(PIXEL_AGENTS_NARROW_VIEWPORT_QUERY, true)

    const { result } = renderHook(() => usePixelAgentsCapability(false))
    expect(result.current).toBe(false)
  })

  it('disallows the graphical office for a prefers-reduced-motion visitor', () => {
    const { matchMedia, setMatches } = createMatchMediaStub()
    vi.stubGlobal('matchMedia', matchMedia)
    setMatches(PIXEL_AGENTS_REDUCED_MOTION_QUERY, true)

    const { result } = renderHook(() => usePixelAgentsCapability(false))
    expect(result.current).toBe(false)
  })

  it('disallows the graphical office once the caller reports a bootstrap failure', () => {
    const { matchMedia } = createMatchMediaStub()
    vi.stubGlobal('matchMedia', matchMedia)

    const { result } = renderHook(() => usePixelAgentsCapability(true))
    expect(result.current).toBe(false)
  })

  it('reacts live to a viewport crossing the narrow breakpoint', () => {
    const { matchMedia, setMatches } = createMatchMediaStub()
    vi.stubGlobal('matchMedia', matchMedia)

    const { result } = renderHook(() => usePixelAgentsCapability(false))
    expect(result.current).toBe(true)

    act(() => setMatches(PIXEL_AGENTS_NARROW_VIEWPORT_QUERY, true))
    expect(result.current).toBe(false)
  })
})
