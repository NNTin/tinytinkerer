import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// This suite pins down the ACTUAL route table createShellRouter builds — '/' mounting
// the chat surface with the resolved presentation, and '/auth/callback' mounting the
// OAuth callback page — using the real react-router-dom hash router. Only the two
// lazily-imported feature pages are mocked (as cheap markers), so an empty or wrong
// route table fails here instead of a mock echoing itself back.
const captured = vi.hoisted((): { presentation: unknown } => ({
  presentation: undefined
}))

vi.mock('../features/chat/chat-surface', () => ({
  ShellChatPage: (props: { presentation: unknown }) => {
    captured.presentation = props.presentation
    return <div data-testid="chat-route" />
  }
}))

vi.mock('../features/auth/callback-page', () => ({
  CallbackPage: () => <div data-testid="callback-route" />
}))

import { createShellRouter } from './router'
import { resolvePresentation } from '../presentations'

afterEach(() => {
  cleanup()
  captured.presentation = undefined
  window.location.hash = ''
})

describe('shell router', () => {
  it('mounts the chat surface at the default route with the resolved presentation', async () => {
    const presentation = resolvePresentation('/web/')
    render(<RouterProvider router={createShellRouter(presentation)} />)

    await screen.findByTestId('chat-route')
    // Identity, not shape: the router must hand the resolved presentation through
    // untouched (its fields are pinned down by presentations.test.ts).
    expect(captured.presentation).toBe(presentation)
  })

  it('mounts the OAuth callback page when the hash targets /auth/callback', async () => {
    // createHashRouter reads window.location.hash at creation time, so set it before
    // building the router. That the route comes FROM the hash is also what proves
    // hash-mode routing (GitHub Pages compatibility): a browser-history router would
    // ignore the hash and render '/' — this replaces the old mocked
    // 'uses hash routing' assertion with a behavioral one.
    window.location.hash = '#/auth/callback'
    render(<RouterProvider router={createShellRouter(resolvePresentation('/web/'))} />)

    await screen.findByTestId('callback-route')
  })
})
