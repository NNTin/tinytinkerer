// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'
import { afterEach, describe, it, vi } from 'vitest'

// Pins down the ACTUAL route table hostRouter builds — '/' mounting the root
// composition, and '/auth/callback' mounting the OAuth callback page — using the
// real react-router-dom hash router. Before this router existed, apps/host had NO
// '/auth/callback' route at all, so GitHub's redirect back to '/#/auth/callback'
// silently re-rendered the root composition and login failed with zero errors
// (issue #409 follow-up). Only the two lazily-imported pages are mocked (as cheap
// markers), mirroring apps/shell/src/app/router.test.tsx, so an empty or wrong
// route table fails here instead of a mock echoing itself back.
//
// Unlike the shell's createShellRouter (a factory called per test), hostRouter is
// created once at module scope — matching a real page load, where the browser has
// already navigated to the target hash before the module ever runs. To exercise
// both routes we therefore set window.location.hash and then re-import the module
// fresh via vi.resetModules(), rather than mutating the hash after a router
// already exists (createHashRouter only reacts to hashchange events, not to the
// hash having moved since it was constructed).

vi.mock('./root-composition', () => ({
  RootComposition: () => <div data-testid="root-composition-route" />
}))

vi.mock('./callback-page', () => ({
  CallbackPage: () => <div data-testid="callback-route" />
}))

const loadRouter = async () => {
  vi.resetModules()
  return import('./router')
}

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('host router', () => {
  it('mounts the root composition at the default route', async () => {
    const { hostRouter } = await loadRouter()
    render(<RouterProvider router={hostRouter} />)

    await screen.findByTestId('root-composition-route')
  })

  it('mounts the OAuth callback page when the hash targets /auth/callback', async () => {
    window.location.hash = '#/auth/callback'
    const { hostRouter } = await loadRouter()
    render(<RouterProvider router={hostRouter} />)

    await screen.findByTestId('callback-route')
  })
})
