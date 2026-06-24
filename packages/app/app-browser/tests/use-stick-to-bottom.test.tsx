// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useStickToBottom } from '../src/use-stick-to-bottom.js'

afterEach(() => {
  cleanup()
})

const Harness = ({ dep }: { dep: number }) => {
  const { scrollRef, isPinned, showJumpButton, scrollToBottom } =
    useStickToBottom<HTMLDivElement>(dep)
  return (
    <div>
      <div data-testid="scroll" ref={scrollRef} />
      <span data-testid="pinned">{String(isPinned)}</span>
      <span data-testid="jump">{String(showJumpButton)}</span>
      <button type="button" onClick={() => scrollToBottom('auto')}>
        jump
      </button>
    </div>
  )
}

// jsdom does no layout and has no element.scrollTo; stub it and fake the metrics.
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn()
})

const setMetrics = (
  el: HTMLElement,
  opts: { scrollHeight: number; clientHeight: number; scrollTop: number }
) => {
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true })
  el.scrollTop = opts.scrollTop
}

describe('useStickToBottom (Q2)', () => {
  it('starts pinned with no jump pill', () => {
    render(<Harness dep={0} />)
    expect(screen.getByTestId('pinned').textContent).toBe('true')
    expect(screen.getByTestId('jump').textContent).toBe('false')
  })

  it('surfaces the jump pill when new content arrives after scrolling up, and clears it on jump', () => {
    const { rerender } = render(<Harness dep={0} />)
    const scroll = screen.getByTestId('scroll')

    // User scrolls well above the bottom.
    setMetrics(scroll, { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
    fireEvent.scroll(scroll)
    expect(screen.getByTestId('pinned').textContent).toBe('false')

    // New content arrives while scrolled up → pill appears (no yank).
    rerender(<Harness dep={1} />)
    expect(screen.getByTestId('jump').textContent).toBe('true')

    // Jumping re-pins and hides the pill.
    fireEvent.click(screen.getByRole('button', { name: 'jump' }))
    expect(screen.getByTestId('pinned').textContent).toBe('true')
    expect(screen.getByTestId('jump').textContent).toBe('false')
  })

  it('keeps following when the user is near the bottom', () => {
    const { rerender } = render(<Harness dep={0} />)
    const scroll = screen.getByTestId('scroll')

    setMetrics(scroll, { scrollHeight: 1000, clientHeight: 200, scrollTop: 790 })
    fireEvent.scroll(scroll)
    expect(screen.getByTestId('pinned').textContent).toBe('true')

    rerender(<Harness dep={1} />)
    expect(screen.getByTestId('jump').textContent).toBe('false')
  })
})
