// @vitest-environment jsdom
/**
 * Dialogs opened over dialogs (issue #481 review, finding 2).
 *
 * The pre-send disclosure's "Read the privacy policy" is a real instance of this,
 * and before the stack existed all three of these were broken at once: one Escape
 * closed both dialogs, the underlying dialog kept trapping Tab so focus could not
 * reach the top one, and two `aria-modal` dialogs claimed the document together.
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDialogEscape, useDialogFocus } from '../src/use-dialog-focus.js'

// This package does not auto-clean between tests, and an un-unmounted dialog
// would leave its token on the module-level stack — which is exactly the state
// these tests are about.
afterEach(cleanup)

const pressEscape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })

const Dialog = ({
  label,
  onDismiss,
  children
}: {
  label: string
  onDismiss: () => void
  children?: React.ReactNode
}) => {
  const ref = useDialogFocus(true)
  useDialogEscape(true, onDismiss)
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}>
      <button type="button">{`${label} action`}</button>
      {children}
    </div>
  )
}

const Stack = ({ onOuterDismiss }: { onOuterDismiss: () => void }) => {
  const [innerOpen, setInnerOpen] = useState(false)
  return (
    <Dialog label="outer" onDismiss={onOuterDismiss}>
      <button type="button" onClick={() => setInnerOpen(true)}>
        open inner
      </button>
      {innerOpen ? <Dialog label="inner" onDismiss={() => setInnerOpen(false)} /> : null}
    </Dialog>
  )
}

describe('stacked dialogs', () => {
  it('gives focus to the dialog on top and marks the one below inert', () => {
    let dismissed = 0
    render(<Stack onOuterDismiss={() => (dismissed += 1)} />)

    const outer = screen.getByRole('dialog', { name: 'outer' })
    expect(outer).not.toHaveAttribute('inert')

    act(() => {
      screen.getByRole('button', { name: 'open inner' }).click()
    })

    // The one underneath leaves the pointer, the tab order, and the
    // accessibility tree — not merely its keydown handler.
    expect(outer).toHaveAttribute('inert')
    expect(screen.getByRole('dialog', { name: 'inner' })).not.toHaveAttribute('inert')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'inner action' }))
    expect(dismissed).toBe(0)
  })

  it('closes only the top dialog on Escape, and returns focus to the one below', () => {
    let dismissed = 0
    render(<Stack onOuterDismiss={() => (dismissed += 1)} />)
    act(() => {
      screen.getByRole('button', { name: 'open inner' }).click()
    })

    pressEscape()

    // The whole point: the reader dismissed the policy, not the disclosure that
    // was holding their message.
    expect(screen.queryByRole('dialog', { name: 'inner' })).toBeNull()
    expect(dismissed).toBe(0)

    const outer = screen.getByRole('dialog', { name: 'outer' })
    expect(outer).not.toHaveAttribute('inert')
    // Focus comes back INTO the dialog below, not out to whatever was focused
    // before the whole stack opened.
    expect(outer.contains(document.activeElement)).toBe(true)

    // …and a second Escape now reaches it.
    pressEscape()
    expect(dismissed).toBe(1)
  })

  it('re-engages the lower dialog only after the upper one is gone', () => {
    render(<Stack onOuterDismiss={() => undefined} />)
    const outer = screen.getByRole('dialog', { name: 'outer' })

    act(() => {
      screen.getByRole('button', { name: 'open inner' }).click()
    })
    expect(outer).toHaveAttribute('inert')

    pressEscape()
    expect(outer).not.toHaveAttribute('inert')
  })
})
