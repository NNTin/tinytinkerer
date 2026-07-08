// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/hooks.js', () => ({
  useBrowserShellConfig: () => ({ theme: undefined })
}))

vi.mock('../src/shell-theme.js', () => ({
  shellThemeToCssVars: () => ({})
}))

import { SidebarLayout } from '../src/chat-shell/sidebar-layout.js'

beforeAll(() => {
  // jsdom lacks pointer capture; the resize handle calls it (guarded), so stub it.
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('SidebarLayout', () => {
  it('renders its children as a full-viewport panel by default (no resize handle)', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:sb">
        <div data-testid="body" />
      </SidebarLayout>
    )
    expect(screen.getByTestId('body')).toBeInTheDocument()
    expect(container.querySelector('.sidebar-resize')).toBeNull()
    expect(container.querySelector('.sidebar-panel')).toBeNull()
  })

  it('shows the undock button only when onUndock is provided and invokes it', () => {
    const onUndock = vi.fn()
    const { rerender } = render(
      <SidebarLayout storageKey="test:sb">
        <div />
      </SidebarLayout>
    )
    expect(screen.queryByRole('button', { name: 'Float chat' })).toBeNull()

    rerender(
      <SidebarLayout storageKey="test:sb" onUndock={onUndock}>
        <div />
      </SidebarLayout>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Float chat' }))
    expect(onUndock).toHaveBeenCalledTimes(1)
  })

  it('resizes the docked panel via the handle and persists the clamped width', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:sb" resizable defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const panel = container.querySelector('.sidebar-panel') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.style.width).toBe('420px')

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    // Right-docked panel grows as the pointer moves left (startX - clientX).
    fireEvent.pointerDown(handle, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 450 })
    fireEvent.pointerUp(window)

    expect(panel.style.width).toBe('470px')
    expect(JSON.parse(window.localStorage.getItem('test:sb') ?? '{}')).toEqual({ width: 470 })
  })

  it('reverts an aborted divider drag instead of committing the mid-drag size (#371)', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:sb" resizable defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const panel = container.querySelector('.sidebar-panel') as HTMLElement
    expect(panel.style.width).toBe('420px')

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.pointerDown(handle, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 450 })
    expect(panel.style.width).toBe('470px')

    fireEvent.pointerCancel(window)
    expect(panel.style.width).toBe('420px')
    expect(JSON.parse(window.localStorage.getItem('test:sb') ?? '{}')).toEqual({ width: 420 })
  })

  it('restores a persisted width on mount, re-clamped to the viewport', () => {
    window.localStorage.setItem('test:sb', JSON.stringify({ width: 480 }))
    const { container } = render(
      <SidebarLayout storageKey="test:sb" resizable defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const panel = container.querySelector('.sidebar-panel') as HTMLElement
    expect(panel.style.width).toBe('480px')
  })

  it('docks to the top edge and resizes along the height axis, persisting { height } (#324)', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:top" resizable edge="top" defaultWidth={400}>
        <div />
      </SidebarLayout>
    )
    const panel = container.querySelector('.sidebar-panel') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel).toHaveAttribute('data-edge', 'top')
    expect(panel.style.height).toBe('400px')
    // Top dock resizes vertically (its handle sits on the panel's bottom inner edge).
    expect(container.querySelector('.sidebar-resize-top')).not.toBeNull()

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    // A top-docked panel grows as the pointer moves down (clientY - startY).
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 150 })
    fireEvent.pointerUp(window)

    expect(panel.style.height).toBe('450px')
    expect(JSON.parse(window.localStorage.getItem('test:top') ?? '{}')).toEqual({ height: 450 })
  })

  it("preserves the other axis's stored size when docking to a perpendicular edge (#335)", () => {
    // A previous side-dock session stored a width; docking top must not erase it.
    window.localStorage.setItem('test:sb', JSON.stringify({ width: 600 }))
    const { container, unmount } = render(
      <SidebarLayout storageKey="test:sb" resizable edge="top" defaultWidth={400}>
        <div />
      </SidebarLayout>
    )

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 150 })
    fireEvent.pointerUp(window)
    expect((container.querySelector('.sidebar-panel') as HTMLElement).style.height).toBe('450px')
    expect(JSON.parse(window.localStorage.getItem('test:sb') ?? '{}')).toEqual({
      width: 600,
      height: 450
    })

    // Round-trip: re-docking to the right restores the untouched width.
    unmount()
    const remounted = render(
      <SidebarLayout storageKey="test:sb" resizable edge="right" defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const panel = remounted.container.querySelector('.sidebar-panel') as HTMLElement
    expect(panel.style.width).toBe('600px')
  })

  it('resizes with arrow keys per the splitter pattern and persists (#356)', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:sb" resizable defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const panel = container.querySelector('.sidebar-panel') as HTMLElement
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })

    // Right dock: ArrowLeft moves the divider toward the centre → the panel grows.
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(panel.style.width).toBe('436px')
    expect(screen.getByRole('status')).toHaveTextContent('Sidebar resized to 436 pixels.')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(panel.style.width).toBe('420px')
    expect(screen.getByRole('status')).toHaveTextContent('Sidebar resized to 420 pixels.')
    expect(JSON.parse(window.localStorage.getItem('test:sb') ?? '{}')).toEqual({ width: 420 })
  })

  it('Home and End jump to the minimum and maximum split size (#356)', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:sb" resizable defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const panel = container.querySelector('.sidebar-panel') as HTMLElement
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    const max = Math.round(window.innerWidth * 0.6)

    fireEvent.keyDown(handle, { key: 'End' })
    expect(panel.style.width).toBe(`${max}px`)

    fireEvent.keyDown(handle, { key: 'Home' })
    expect(panel.style.width).toBe('320px')
  })

  it('ignores off-axis arrows (#356)', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:sb" resizable defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const panel = container.querySelector('.sidebar-panel') as HTMLElement

    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize sidebar' }), {
      key: 'ArrowUp'
    })
    expect(panel.style.width).toBe('420px')
  })

  it('exposes window-splitter semantics (#356)', () => {
    render(
      <SidebarLayout storageKey="test:sb" resizable defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    // A right dock has a vertical divider whose value is the panel width.
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '420')
    expect(handle).toHaveAttribute('aria-valuemin', '320')
    expect(handle).toHaveAttribute('aria-valuemax', `${Math.round(window.innerWidth * 0.6)}`)
    cleanup()

    render(
      <SidebarLayout storageKey="test:top" resizable edge="top" defaultWidth={420}>
        <div />
      </SidebarLayout>
    )
    // A top dock's divider is horizontal.
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute(
      'aria-orientation',
      'horizontal'
    )
  })

  it('ignores resizable in the mobile variant (full-bleed, no handle)', () => {
    const { container } = render(
      <SidebarLayout storageKey="test:sb" resizable sizeVariant="mobile">
        <div data-testid="body" />
      </SidebarLayout>
    )
    expect(screen.getByTestId('body')).toBeInTheDocument()
    expect(container.querySelector('.sidebar-resize')).toBeNull()
    expect(container.querySelector('.sidebar-panel')).toBeNull()
  })
})
