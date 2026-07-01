// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../src/chat-shell/floating-chat-surface.js', () => ({
  FloatingChatSurface: () => <div data-testid="floating-body" />
}))

vi.mock('../src/chat-shell/docked-chat-surface.js', () => ({
  DockedChatSurface: () => <div data-testid="docked-body" />
}))

import { ChatApp } from '../src/chat-shell/chat-app.js'

const Loading = () => <div data-loading="true" />

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  window.localStorage.clear()
})

describe('ChatApp', () => {
  it('starts in the requested layout', () => {
    render(<ChatApp mode="sidebar" storageKey="k" LoadingComponent={Loading} />)
    expect(screen.getByTestId('docked-body')).toBeInTheDocument()
    expect(screen.queryByTestId('floating-body')).toBeNull()
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
