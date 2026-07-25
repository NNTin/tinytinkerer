import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LabReset } from '../LabReset'
import { LabSessionContext, type LabSessionContextValue } from '../lab-session-context'

const renderReset = (
  reset: LabSessionContextValue['reset'],
  status: LabSessionContextValue['snapshot']['status'] = 'ready'
) => {
  const signIn = vi.fn()
  const value: LabSessionContextValue = {
    snapshot: { status, error: null, retryAt: null },
    signIn,
    reset
  }
  render(
    <LabSessionContext.Provider value={value}>
      <LabReset />
    </LabSessionContext.Provider>
  )
}

describe('LabReset', () => {
  it('renders nothing outside a <LiveLab> boundary', () => {
    const { container } = render(<LabReset />)
    expect(container).toBeEmptyDOMElement()
  })

  it('calls context.reset() when clicked', async () => {
    const user = userEvent.setup()
    const reset = vi.fn().mockResolvedValue(undefined)
    renderReset(reset)
    await user.click(screen.getByRole('button', { name: /reset this lab/i }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('disables the button and shows a resetting label while status is reset', () => {
    renderReset(vi.fn(), 'reset')
    const button = screen.getByRole('button', { name: /resetting/i })
    expect(button).toBeDisabled()
  })

  it('surfaces a reset failure without crashing', async () => {
    const user = userEvent.setup()
    const reset = vi.fn().mockRejectedValue(new Error('could not clear the lab session'))
    renderReset(reset)
    await user.click(screen.getByRole('button', { name: /reset this lab/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not clear the lab session')
  })

  it('supports a custom label', () => {
    render(
      <LabSessionContext.Provider
        value={{
          snapshot: { status: 'ready', error: null, retryAt: null },
          signIn: vi.fn(),
          reset: vi.fn()
        }}
      >
        <LabReset label="Start over" />
      </LabSessionContext.Provider>
    )
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument()
  })
})
