// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Controlled minimization and focus behaviour (issue #480).
 *
 * `FloatingLayout` persists `minimized` inside its geometry blob, which is right
 * for a shell that mounts its widget on page load and wrong for an embedder whose
 * widget does not exist until something activates it. The documentation assistant
 * therefore owns open/minimized itself, and this covers the two properties that
 * makes it depend on: the caller's value wins outright, and the layout reports
 * every change instead of quietly keeping a second copy.
 *
 * Focus is here rather than in a docs test because it is `FloatingLayout` that
 * makes the element a reader was using disappear — only it knows where focus
 * should land afterwards.
 *
 * The body is stubbed to a bare textarea: this file is about the window chrome,
 * and the real body's wiring is covered by floating-layout.test.tsx.
 */

vi.mock('../src/hooks.js', () => ({
  useBrowserShellConfig: () => ({ theme: undefined })
}))

vi.mock('../src/shell-theme.js', () => ({
  shellThemeToCssVars: () => ({})
}))

import { FloatingLayout } from '../src/chat-shell/floating-layout.js'

const Body = () => <textarea aria-label="Message" />

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

const minimizeButton = () => screen.getByRole('button', { name: 'Minimize widget' })
const launcher = () => screen.getByRole('button', { name: 'Restore widget' })

describe('uncontrolled minimization (every existing surface)', () => {
  it('keeps owning the state, and still reports changes', () => {
    const onMinimizedChange = vi.fn()
    render(
      <FloatingLayout storageKey="test:uncontrolled" onMinimizedChange={onMinimizedChange}>
        <Body />
      </FloatingLayout>
    )

    fireEvent.click(minimizeButton())
    expect(launcher()).toBeInTheDocument()
    expect(onMinimizedChange).toHaveBeenCalledWith(true)

    fireEvent.click(launcher())
    expect(minimizeButton()).toBeInTheDocument()
    expect(onMinimizedChange).toHaveBeenLastCalledWith(false)
  })

  it('still lets initialMinimized override a persisted layout', () => {
    // What `?window=minimized` relies on (apps/shell's widget presentation):
    // the URL wins over whatever the reader last left behind.
    window.localStorage.setItem(
      'test:override',
      JSON.stringify({ x: 40, y: 40, width: 400, height: 680, minimized: false })
    )
    render(
      <FloatingLayout storageKey="test:override" initialMinimized>
        <Body />
      </FloatingLayout>
    )

    expect(launcher()).toBeInTheDocument()
  })
})

describe('controlled minimization (issue #480)', () => {
  it('renders the caller"s value and does not change it on its own', () => {
    const onMinimizedChange = vi.fn()
    render(
      <FloatingLayout storageKey="test:controlled" minimized onMinimizedChange={onMinimizedChange}>
        <Body />
      </FloatingLayout>
    )

    expect(launcher()).toBeInTheDocument()

    // The layout reports the request and leaves the decision to the caller —
    // the state must not move underneath a controlled owner.
    fireEvent.click(launcher())
    expect(onMinimizedChange).toHaveBeenCalledWith(false)
    expect(launcher()).toBeInTheDocument()
  })

  it('ignores a persisted minimized flag, so the two can never disagree', () => {
    // The exact drift this mode exists to prevent: a stored `true` from an
    // earlier session, against a caller that says the panel is open. Whatever
    // #472 or a launcher did to open it must win.
    window.localStorage.setItem(
      'test:controlled-stale',
      JSON.stringify({ x: 40, y: 40, width: 400, height: 680, minimized: true })
    )
    render(
      <FloatingLayout storageKey="test:controlled-stale" minimized={false}>
        <Body />
      </FloatingLayout>
    )

    expect(minimizeButton()).toBeInTheDocument()
  })

  it('follows the caller when the prop changes', () => {
    const Host = () => {
      const [minimized, setMinimized] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setMinimized(false)}>
            open from elsewhere
          </button>
          <FloatingLayout
            storageKey="test:controlled-follow"
            minimized={minimized}
            onMinimizedChange={setMinimized}
          >
            <Body />
          </FloatingLayout>
        </>
      )
    }
    render(<Host />)

    expect(launcher()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'open from elsewhere' }))
    expect(minimizeButton()).toBeInTheDocument()

    // …and the widget's own control still round-trips through the owner.
    fireEvent.click(minimizeButton())
    expect(launcher()).toBeInTheDocument()
  })
})

describe('focus follows the widget, never a page load', () => {
  it('moves focus to the launcher when minimized', () => {
    render(
      <FloatingLayout storageKey="test:focus-minimize">
        <Body />
      </FloatingLayout>
    )

    fireEvent.click(minimizeButton())
    expect(launcher()).toHaveFocus()
  })

  it('moves focus into the composer when restored', () => {
    render(
      <FloatingLayout storageKey="test:focus-restore">
        <Body />
      </FloatingLayout>
    )

    fireEvent.click(minimizeButton())
    fireEvent.click(launcher())
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  })

  it('takes no focus on an ordinary mount', () => {
    // Every product shell mounts this during page load; stealing focus there
    // would drop a reader out of whatever they were doing.
    render(
      <FloatingLayout storageKey="test:focus-mount">
        <Body />
      </FloatingLayout>
    )

    expect(document.body).toHaveFocus()
  })

  it('takes focus on mount only when the host asks for it', () => {
    // The cold-activation case: a reader clicked a launcher and is waiting for
    // somewhere to type.
    render(
      <FloatingLayout storageKey="test:focus-mount-opt-in" focusPanelOnMount>
        <Body />
      </FloatingLayout>
    )

    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
  })

  it('does not trap focus — the widget is non-modal', () => {
    // Nothing outside the widget is made inert or aria-hidden, so a keyboard
    // reader can Tab straight back out into the host page.
    const { container } = render(
      <FloatingLayout storageKey="test:focus-nonmodal" focusPanelOnMount>
        <Body />
      </FloatingLayout>
    )

    expect(container.querySelector('[aria-modal="true"]')).toBeNull()
    expect(document.body.getAttribute('aria-hidden')).toBeNull()
    expect(container.querySelector('[inert]')).toBeNull()
  })
})
