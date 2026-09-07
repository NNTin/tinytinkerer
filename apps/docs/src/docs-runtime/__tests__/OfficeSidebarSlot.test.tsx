/**
 * The documentation sidebar's Office slot (issue #472).
 *
 * What these pin is the *target lifecycle*, because that is the whole of what
 * this component does and every way it can be wrong is invisible in its own
 * render: an unregistered target means no Office anywhere, and a target left
 * registered after collapse means an iframe still running behind a control that
 * says it is off.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
})

const load = async () => {
  const constants = await import('../assistant-constants')
  const surface = await import('../assistant-surface')
  // The registry only reports a target alongside a REGISTERED component, which
  // in production is the Office itself, registered at the runtime chunk's
  // module scope. Standing in for it here keeps this suite about the slot while
  // observing the registry the way the host does.
  surface.registerDocsAssistantSurface(constants.DOCS_ASSISTANT_OFFICE_SURFACE_ID, () => null, {
    placement: 'portal'
  })

  const officeTarget = (): HTMLElement | null =>
    surface
      .readDocsAssistantSurfaces()
      .find(({ id }) => id === constants.DOCS_ASSISTANT_OFFICE_SURFACE_ID)?.target ?? null

  return {
    ...constants,
    ...surface,
    ...(await import('../assistant-activation')),
    ...(await import('../office-collapse')),
    ...(await import('../OfficeSidebarSlot')),
    /** The one thing worth observing: is a live portal target registered? */
    officeTarget
  }
}

describe('DocsAssistantOfficeSidebarSlot', () => {
  it('registers no target and offers activation before anything has been downloaded', async () => {
    const { DocsAssistantOfficeSidebarSlot, officeTarget } = await load()

    render(<DocsAssistantOfficeSidebarSlot />)

    expect(officeTarget()).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Show your assistant conversations' })
    ).toBeInTheDocument()
    // Nothing to hide yet, so no toggle to press.
    expect(screen.queryByRole('button', { name: /^(Hide|Show)$/ })).not.toBeInTheDocument()
  })

  it('asks for the runtime and registers the target once it starts', async () => {
    const { DocsAssistantOfficeSidebarSlot, officeTarget, readDocsAssistantRuntimeStatus } =
      await load()

    render(<DocsAssistantOfficeSidebarSlot />)
    await userEvent.click(screen.getByRole('button', { name: 'Show your assistant conversations' }))

    expect(readDocsAssistantRuntimeStatus()).toBe('starting')
    expect(officeTarget()).toBeInstanceOf(HTMLElement)
    // At its final height from the first frame, so the room arriving moves
    // nothing on the page.
    expect(screen.getByRole('status')).toHaveTextContent('Opening the agent office…')
  })

  it('withdraws the target when collapsed, so the office unmounts rather than hides', async () => {
    const { DocsAssistantOfficeSidebarSlot, officeTarget, publishDocsAssistantRuntimeStatus } =
      await load()

    render(<DocsAssistantOfficeSidebarSlot />)
    act(() => publishDocsAssistantRuntimeStatus('starting'))
    act(() => publishDocsAssistantRuntimeStatus('ready'))
    expect(officeTarget()).toBeInstanceOf(HTMLElement)

    await userEvent.click(screen.getByRole('button', { name: 'Hide' }))

    expect(officeTarget()).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Show' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    expect(officeTarget()).toBeInstanceOf(HTMLElement)
  })

  it('withdraws the target when the sidebar itself unmounts', async () => {
    // Every route without a documentation sidebar — search, a 404 — and every
    // SPA navigation between them. A stale target would leave the Office
    // portaled into a detached element instead of rendering nothing.
    const { DocsAssistantOfficeSidebarSlot, officeTarget, publishDocsAssistantRuntimeStatus } =
      await load()

    const { unmount } = render(<DocsAssistantOfficeSidebarSlot />)
    act(() => publishDocsAssistantRuntimeStatus('ready'))
    expect(officeTarget()).toBeInstanceOf(HTMLElement)

    unmount()

    expect(officeTarget()).toBeNull()
  })

  it('offers a retry that starts a fresh attempt after a failed start', async () => {
    const {
      DocsAssistantOfficeSidebarSlot,
      publishDocsAssistantRuntimeStatus,
      readDocsAssistantRuntimeStatus
    } = await load()

    render(<DocsAssistantOfficeSidebarSlot />)
    act(() => publishDocsAssistantRuntimeStatus('error'))

    // Says what happened AND what the button now does — a state advertising a
    // retry has to have one (#476's lesson, #480's launcher wording).
    const retry = screen.getByRole('button', {
      name: 'The agent office failed to start. Try again'
    })
    await userEvent.click(retry)

    expect(readDocsAssistantRuntimeStatus()).toBe('starting')
  })

  it('restores a collapsed slot on the next visit', async () => {
    const { DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY } = await import('../assistant-constants')
    window.localStorage.setItem(DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY, 'true')

    const { DocsAssistantOfficeSidebarSlot, officeTarget, publishDocsAssistantRuntimeStatus } =
      await load()

    render(<DocsAssistantOfficeSidebarSlot />)
    act(() => publishDocsAssistantRuntimeStatus('ready'))

    expect(officeTarget()).toBeNull()
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands and activates in one press from a collapsed slot on a cold page', async () => {
    // A returning reader gets `idle` plus a stored collapse: the preference
    // survived the reload, the runtime did not. One press has to do both, or
    // "Show" leaves them looking at an empty box waiting for a second.
    const { DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY } = await import('../assistant-constants')
    window.localStorage.setItem(DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY, 'true')

    const { DocsAssistantOfficeSidebarSlot, officeTarget, readDocsAssistantRuntimeStatus } =
      await load()

    render(<DocsAssistantOfficeSidebarSlot />)
    // Collapsed is the reader's standing choice about this panel, so the toggle
    // is what they see — not the first-visit invitation.
    expect(
      screen.queryByRole('button', { name: 'Show your assistant conversations' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))

    expect(readDocsAssistantRuntimeStatus()).toBe('starting')
    expect(officeTarget()).toBeInstanceOf(HTMLElement)
  })
})
