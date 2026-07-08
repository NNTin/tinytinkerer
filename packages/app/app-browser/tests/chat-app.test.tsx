// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ChatApp picks a layout by `mode` and, when morphable, exposes a dock/undock toggle
// that swaps FloatingLayout <-> SidebarLayout. Here we use the REAL layouts (session
// continuity comes from the AppBrowserProvider above ChatApp, not tested at this
// level) with trivial mocked bodies, and assert the toggle + mode persistence.

vi.mock('../src/hooks.js', () => ({
  useBrowserShellConfig: () => ({ theme: undefined })
}))

vi.mock('../src/shell-theme.js', () => ({
  shellThemeToCssVars: () => ({})
}))

vi.mock('@tinytinkerer/brand-assets', () => ({
  TINYTINKERER_BRAND_ASSET_URLS: { icon192: '' }
}))

const capturedFloating = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined
}))

vi.mock('../src/chat-shell/floating-chat-surface.js', () => ({
  FloatingChatSurface: (props: Record<string, unknown>) => {
    capturedFloating.props = props
    return <div data-testid="floating-body" />
  }
}))

const capturedDocked = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined
}))

vi.mock('../src/chat-shell/docked-chat-surface.js', () => ({
  DockedChatSurface: (props: Record<string, unknown>) => {
    capturedDocked.props = props
    return <div data-testid="docked-body" />
  }
}))

import { ChatApp } from '../src/chat-shell/chat-app.js'

const Loading = () => <div data-loading="true" />

beforeAll(() => {
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  window.localStorage.clear()
  capturedFloating.props = undefined
  capturedDocked.props = undefined
})

describe('ChatApp', () => {
  it('starts in the requested layout', () => {
    render(<ChatApp mode="sidebar" storageKey="k" LoadingComponent={Loading} />)
    expect(screen.getByTestId('docked-body')).toBeInTheDocument()
    expect(screen.queryByTestId('floating-body')).toBeNull()
  })

  it('threads inspectorPanelSupported into the floating body (so the widget can enable it)', () => {
    render(
      <ChatApp mode="floating" storageKey="k" LoadingComponent={Loading} inspectorPanelSupported />
    )
    expect(capturedFloating.props?.inspectorPanelSupported).toBe(true)
  })

  it('threads inspectorPanelSupported into the docked body (so web/canvas can enable it)', () => {
    render(
      <ChatApp mode="sidebar" storageKey="k" LoadingComponent={Loading} inspectorPanelSupported />
    )
    expect(capturedDocked.props?.inspectorPanelSupported).toBe(true)
  })

  it('morphs floating -> sidebar -> floating via the dock/undock toggle', () => {
    render(<ChatApp mode="floating" storageKey="k" LoadingComponent={Loading} />)
    expect(screen.getByTestId('floating-body')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dock to sidebar' }))
    expect(screen.getByTestId('docked-body')).toBeInTheDocument()
    expect(screen.queryByTestId('floating-body')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Float chat' }))
    expect(screen.getByTestId('floating-body')).toBeInTheDocument()
  })

  it('persists the chosen mode and each layout uses a suffixed storage key', () => {
    const { unmount } = render(
      <ChatApp mode="floating" storageKey="k" LoadingComponent={Loading} />
    )
    // The floating layout persists its geometry under the ":floating" suffix.
    expect(window.localStorage.getItem('k:floating')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Dock to sidebar' }))
    expect(window.localStorage.getItem('k:mode')).toBe('sidebar')

    // A fresh mount restores the persisted mode.
    unmount()
    render(<ChatApp mode="floating" storageKey="k" LoadingComponent={Loading} />)
    expect(screen.getByTestId('docked-body')).toBeInTheDocument()
  })

  it('snap-docks to the edge a drag is released in, then undocks (#324)', () => {
    const { container } = render(
      <ChatApp mode="floating" storageKey="k" LoadingComponent={Loading} />
    )
    expect(screen.getByTestId('floating-body')).toBeInTheDocument()

    // Drag the grip to the right edge and release → morph into the right-docked split.
    const grip = screen.getByRole('button', { name: /move widget/i })
    fireEvent.pointerDown(grip, { clientX: 300, clientY: 300, pointerId: 2 })
    fireEvent.pointerMove(window, { clientX: window.innerWidth - 3, clientY: 300 })
    fireEvent.pointerUp(window)

    const panel = container.querySelector('.sidebar-panel') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel).toHaveAttribute('data-edge', 'right')
    expect(screen.getByTestId('docked-body')).toBeInTheDocument()
    expect(window.localStorage.getItem('k:edge')).toBe('right')

    // The docked web mode is resizable (issue #324) and can morph back to floating.
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Float chat' }))
    expect(screen.getByTestId('floating-body')).toBeInTheDocument()
  })

  it('hides the dock/undock toggle when not morphable', () => {
    render(<ChatApp mode="floating" morphable={false} storageKey="k" LoadingComponent={Loading} />)
    expect(screen.queryByRole('button', { name: 'Dock to sidebar' })).toBeNull()
    expect(screen.getByTestId('floating-body')).toBeInTheDocument()
  })

  it('notifies onModeChange when morphing', () => {
    const onModeChange = vi.fn()
    render(
      <ChatApp
        mode="floating"
        storageKey="k"
        LoadingComponent={Loading}
        onModeChange={onModeChange}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dock to sidebar' }))
    expect(onModeChange).toHaveBeenCalledWith('sidebar')
  })
})
