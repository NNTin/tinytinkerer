// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoadingStatusPanel } from '../src/loading-status-panel.js'

describe('LoadingStatusPanel', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the eyebrow, title, and message', () => {
    render(
      <LoadingStatusPanel
        variant="workspace"
        eyebrow="Workspace Boot"
        title="Loading tinytinkerer"
        message="Bringing the web shell online."
      />
    )

    expect(screen.getByText('Workspace Boot')).toBeInTheDocument()
    expect(screen.getByText('Loading tinytinkerer')).toBeInTheDocument()
    expect(screen.getByText('Bringing the web shell online.')).toBeInTheDocument()
  })

  it('renders the error block with a working Reload button when error is set', () => {
    const onReload = vi.fn()
    render(
      <LoadingStatusPanel
        variant="workspace"
        eyebrow="Workspace Boot"
        title="Loading tinytinkerer"
        message="Bringing the web shell online."
        error="boot exploded"
        onReload={onReload}
      />
    )

    expect(screen.getByText('Startup failed')).toBeInTheDocument()
    expect(screen.getByText('boot exploded')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('renders the idle indicator when idleMessage is set and there is no error', () => {
    render(
      <LoadingStatusPanel
        variant="widget"
        eyebrow="Widget Boot"
        title="Loading tinytinkerer"
        message="Starting the shared browser shell."
        idleMessage="Preparing the widget shell and local state."
      />
    )

    expect(screen.getByText('Preparing the widget shell and local state.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    expect(screen.queryByText('Startup failed')).not.toBeInTheDocument()
  })

  it('renders neither idle indicator nor Reload button when neither error nor idleMessage is set', () => {
    render(
      <LoadingStatusPanel
        variant="widget"
        eyebrow="Canvas Boot"
        title="Loading tinytinkerer"
        message="Starting the chat shell and isolated whiteboard."
      />
    )

    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    expect(screen.queryByText('Startup failed')).not.toBeInTheDocument()
  })
})
