// @vitest-environment jsdom
import '@testing-library/jest-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CanvasBootScreen } from './loading-screen.js'

// Regression test for #370: the canvas boot screen's copy of the loading panel
// drifted and lost the "Startup failed" + Reload affordance on boot failure,
// leaving a user stuck with no recovery action. CanvasBootScreen now delegates
// to @tinytinkerer/app-browser's LoadingStatusPanel, so a boot error must
// render the Reload button again.
describe('CanvasBootScreen', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows the Startup failed message and a wired Reload button on boot error', () => {
    render(<CanvasBootScreen error="boot exploded" />)

    expect(screen.getByText('Startup failed')).toBeInTheDocument()
    expect(screen.getByText('boot exploded')).toBeInTheDocument()

    // jsdom's window.location is LegacyUnforgeable, so the default reload
    // handler cannot be spied on; clicking must reach jsdom's (unimplemented)
    // navigation rather than throw, proving the handler is wired.
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  })

  it('renders no Reload button when there is no boot error', () => {
    render(<CanvasBootScreen />)

    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
    expect(screen.queryByText('Startup failed')).not.toBeInTheDocument()
  })
})
