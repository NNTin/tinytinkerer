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

  it.each(['ready', 'running'] as const)('renders children when status is %s', (status) => {
    renderWithStatus(status)
    expect(screen.getByText('protected content')).toBeInTheDocument()
  })

  it('does not render protected children while loading', () => {
    renderWithStatus('loading')
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
  })

  it('shows a sign-in call to action when signed out, and wires it to context.signIn', async () => {
    const user = userEvent.setup()
    const { signIn } = renderWithStatus('signed-out')
    expect(screen.queryByText('protected content')).not.toBeInTheDocument()
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

  it('honors per-status overrides', () => {
    renderWithStatus('signed-out', {})
    // default sign-in fallback is used absent an override
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})
