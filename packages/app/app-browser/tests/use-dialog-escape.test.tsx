// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDialogEscape } from '../src/use-dialog-focus.js'

afterEach(() => {
  cleanup()
})

const Harness = ({ active, onDismiss }: { active: boolean; onDismiss: () => void }) => {
  useDialogEscape(active, onDismiss)
  return null
}

describe('useDialogEscape', () => {
  it('calls onDismiss once when Escape is pressed while active', () => {
    const onDismiss = vi.fn()
    render(<Harness active onDismiss={onDismiss} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys', () => {
    const onDismiss = vi.fn()
    render(<Harness active onDismiss={onDismiss} />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does nothing when inactive', () => {
    const onDismiss = vi.fn()
    render(<Harness active={false} onDismiss={onDismiss} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('calls the latest onDismiss after a rerender with a new callback', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Harness active onDismiss={first} />)

    rerender(<Harness active onDismiss={second} />)
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('calls nothing after unmount', () => {
    const onDismiss = vi.fn()
    const { unmount } = render(<Harness active onDismiss={onDismiss} />)

    unmount()
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onDismiss).not.toHaveBeenCalled()
  })
})
