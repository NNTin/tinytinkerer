import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LiveSessionGate } from '../LiveSessionGate'
import {
  LabSessionContext,
  type LabSessionContextValue,
  type LabSessionStatus
} from '../lab-session-context'

const renderWithStatus = (
  status: LabSessionStatus,
  overrides: Partial<LabSessionContextValue> = {},
  retryAt: string | null = null
) => {
  const signIn = vi.fn()
  const reset = vi.fn().mockResolvedValue(undefined)
  const value: LabSessionContextValue = {
    snapshot: { status, error: status === 'error' ? 'boom' : null, retryAt },
    signIn,
    reset,
    ...overrides
  }
  render(
    <LabSessionContext.Provider value={value}>
      <LiveSessionGate>
        <p>protected content</p>
      </LiveSessionGate>
    </LabSessionContext.Provider>
  )
  return { signIn, reset }
}

describe('LiveSessionGate', () => {
  it('renders nothing outside a <LiveLab> boundary', () => {
    const { container } = render(
      <LiveSessionGate>
        <p>protected content</p>
      </LiveSessionGate>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['ready', 'running', 'signed-out'] as const)(
    'renders children when status is %s',
    (status) => {
      renderWithStatus(status)
      expect(screen.getByText('protected content')).toBeInTheDocument()
    }
  )

  it('does not render protected children while loading', () => {
    renderWithStatus('loading')
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
  })

  it('renders children AND a non-blocking sign-in notice when signed out, wired to context.signIn', async () => {
    const user = userEvent.setup()
    const { signIn } = renderWithStatus('signed-out')
    // Signed-out must never hide the lab: TinyTinkerer's own chat surfaces work
    // anonymously against the shared key by default, and so must the docs labs.
    expect(screen.getByText('protected content')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /sign in/i })
    await user.click(button)
    expect(signIn).toHaveBeenCalledTimes(1)
  })

  it('shows a rate-limit message', () => {
    renderWithStatus('rate-limited', {}, new Date(Date.now() + 30_000).toISOString())
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/rate limited/i)
  })

  it('shows the error message', () => {
    renderWithStatus('error')
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  it('shows a resetting message', () => {
    renderWithStatus('reset')
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/resetting/i)
  })

  it('uses the default signed-out notice absent a `signedOut` override', () => {
    renderWithStatus('signed-out')
    expect(screen.getByText(/shared, rate-limited key/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('honors a `signedOut` override for the notice, alongside children and the sign-in button', () => {
    const signIn = vi.fn()
    const reset = vi.fn().mockResolvedValue(undefined)
    const value: LabSessionContextValue = {
      snapshot: { status: 'signed-out', error: null, retryAt: null },
      signIn,
      reset
    }
    render(
      <LabSessionContext.Provider value={value}>
        <LiveSessionGate signedOut={<p>custom signed-out copy</p>}>
          <p>protected content</p>
        </LiveSessionGate>
      </LabSessionContext.Provider>
    )
    expect(screen.getByText('custom signed-out copy')).toBeInTheDocument()
    expect(screen.getByText('protected content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})
