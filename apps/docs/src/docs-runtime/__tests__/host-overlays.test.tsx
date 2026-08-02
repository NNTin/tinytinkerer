/**
 * Getting out of the way of a host overlay (issue #480).
 *
 * The assistant sits above the ordinary Docusaurus chrome, which is right for a
 * navbar and wrong for the three surfaces that take over the viewport. The
 * property that matters most here is the negative one: the assistant's OWN
 * dialogs must not trigger this, or a first-time reader would never be able to
 * answer the telemetry consent prompt that opens with it.
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DOCS_HOST_OVERLAY_SELECTORS,
  resetDocsHostOverlaysForTests,
  setDocsHostOverlay,
  useDocsHostOverlayOpen
} from '../host-overlays'

// The module coalesces DOM mutations into one evaluation per frame, so a test
// that changes the DOM has to let that frame run.
const flushFrame = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        resolve(undefined)
      })
    })
  })
}

beforeEach(() => {
  resetDocsHostOverlaysForTests()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  resetDocsHostOverlaysForTests()
})

describe('documentation-owned overlays', () => {
  it('are declared, not sniffed for', () => {
    const { result } = renderHook(() => useDocsHostOverlayOpen())
    expect(result.current).toBe(false)

    act(() => {
      setDocsHostOverlay('lab-fullscreen:one', true)
    })
    expect(result.current).toBe(true)

    act(() => {
      setDocsHostOverlay('lab-fullscreen:one', false)
    })
    expect(result.current).toBe(false)
  })

  it('are tracked per id, so one closing does not clear another', () => {
    const { result } = renderHook(() => useDocsHostOverlayOpen())

    act(() => {
      setDocsHostOverlay('lab-fullscreen:one', true)
      setDocsHostOverlay('lab-fullscreen:two', true)
    })
    act(() => {
      setDocsHostOverlay('lab-fullscreen:one', false)
    })
    expect(result.current).toBe(true)

    act(() => {
      setDocsHostOverlay('lab-fullscreen:two', false)
    })
    expect(result.current).toBe(false)
  })
})

describe('the selectors themselves', () => {
  it('match published contracts, never a build-time class name', () => {
    // Both are stable across a dependency bump in a way a CSS-module class is
    // not: `navbar-sidebar--show` is what Infima's own stylesheet keys the
    // mobile drawer's transform off, and the combobox state is WAI-ARIA. The
    // search plugin's own class names are rehashed on every build.
    expect(DOCS_HOST_OVERLAY_SELECTORS).toEqual([
      '.navbar-sidebar--show',
      '.navbar__search [role="combobox"][aria-expanded="true"]'
    ])
    for (const selector of DOCS_HOST_OVERLAY_SELECTORS) {
      // Valid, and inert on a page that has neither — a 404 route has no navbar.
      expect(() => document.querySelector(selector)).not.toThrow()
      expect(document.querySelector(selector)).toBeNull()
    }
  })
})

describe('Docusaurus-owned overlays', () => {
  it('detects the mobile navigation drawer', async () => {
    // theme-classic sets this class on the navbar while the drawer is open; it
    // is what Infima's own stylesheet keys the drawer's transform off.
    const navbar = document.createElement('div')
    navbar.className = 'navbar'
    document.body.append(navbar)

    const { result } = renderHook(() => useDocsHostOverlayOpen())
    expect(result.current).toBe(false)

    navbar.classList.add('navbar-sidebar--show')
    await flushFrame()
    expect(result.current).toBe(true)

    navbar.classList.remove('navbar-sidebar--show')
    await flushFrame()
    expect(result.current).toBe(false)
  })

  it('detects the search dropdown through its ARIA state, not a hashed class', async () => {
    // The plugin's CSS-module class names are rehashed on every build; the
    // combobox contract its autocomplete implements is not.
    const search = document.createElement('div')
    search.className = 'navbar__search'
    const input = document.createElement('input')
    input.setAttribute('role', 'combobox')
    input.setAttribute('aria-expanded', 'false')
    search.append(input)
    document.body.append(search)

    const { result } = renderHook(() => useDocsHostOverlayOpen())
    expect(result.current).toBe(false)

    input.setAttribute('aria-expanded', 'true')
    await flushFrame()
    expect(result.current).toBe(true)

    input.setAttribute('aria-expanded', 'false')
    await flushFrame()
    expect(result.current).toBe(false)
  })
})

describe('the assistant"s own dialogs', () => {
  it('never count as a host overlay', async () => {
    // The defect a generic "any open aria-modal" rule would have: the telemetry
    // consent dialog opens the first time the assistant activates, and hiding
    // the assistant for it would leave a reader unable to answer the prompt
    // blocking their first question.
    const consent = document.createElement('div')
    consent.setAttribute('role', 'dialog')
    consent.setAttribute('aria-modal', 'true')
    consent.setAttribute('aria-label', 'Privacy & Telemetry')
    document.body.append(consent)

    const { result } = renderHook(() => useDocsHostOverlayOpen())
    await flushFrame()

    expect(result.current).toBe(false)
  })
})

describe('subscription lifecycle', () => {
  it('stops observing once the last consumer unmounts', () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const first = renderHook(() => useDocsHostOverlayOpen())
    const second = renderHook(() => useDocsHostOverlayOpen())

    first.unmount()
    expect(disconnect).not.toHaveBeenCalled()

    second.unmount()
    expect(disconnect).toHaveBeenCalled()
    disconnect.mockRestore()
  })

  it('keeps a mounted subscriber in step when the test reset clears a declared overlay', () => {
    // `useSyncExternalStore` caches the snapshot it was last told about, so a
    // reset that mutated module state silently left a mounted subscriber
    // rendering `true` against a store reading `false` — and `evaluate`'s
    // `next === open` guard then swallowed the next real open, because from the
    // store's point of view nothing had moved (issue #482, finding 4).
    const { result } = renderHook(() => useDocsHostOverlayOpen())

    act(() => {
      setDocsHostOverlay('lab-fullscreen:one', true)
    })
    expect(result.current).toBe(true)

    act(() => {
      resetDocsHostOverlaysForTests()
    })
    expect(result.current).toBe(false)

    // …and the store is genuinely usable afterwards, which is the half a plain
    // snapshot assertion would miss.
    act(() => {
      setDocsHostOverlay('lab-fullscreen:two', true)
    })
    expect(result.current).toBe(true)
  })

  it('renders nothing surprising when the page has no navbar or search at all', async () => {
    // A 404 route, or a static render: the selectors simply match nothing.
    const Probe = () => <span>{useDocsHostOverlayOpen() ? 'hidden' : 'shown'}</span>
    render(<Probe />)
    await flushFrame()

    expect(screen.getByText('shown')).toBeInTheDocument()
  })
})
