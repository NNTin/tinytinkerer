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

    const handle = screen.getByRole('button', { name: 'Resize sidebar' })
    // Right-docked panel grows as the pointer moves left (startX - clientX).
    fireEvent.pointerDown(handle, { clientX: 500 })
    fireEvent.pointerMove(window, { clientX: 450 })
    fireEvent.pointerUp(window)

    expect(panel.style.width).toBe('470px')
    expect(JSON.parse(window.localStorage.getItem('test:sb') ?? '{}')).toEqual({ width: 470 })
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

    const handle = screen.getByRole('button', { name: 'Resize sidebar' })
    // A top-docked panel grows as the pointer moves down (clientY - startY).
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 150 })
    fireEvent.pointerUp(window)

    expect(panel.style.height).toBe('450px')
    expect(JSON.parse(window.localStorage.getItem('test:top') ?? '{}')).toEqual({ height: 450 })
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
