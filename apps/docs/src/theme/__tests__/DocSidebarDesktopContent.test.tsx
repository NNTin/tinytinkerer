/**
 * The swizzled documentation sidebar (issue #472).
 *
 * Two things can go wrong here and neither is visible in the slot's own tests:
 * the wrapper could REPLACE the theme's navigation instead of adding to it, and
 * it could keep offering the Office on a deployment where #481's rollback
 * switch has turned the assistant off.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const assistantEnabled = vi.hoisted(() => ({ value: true }))

vi.mock('@site/src/docs-runtime', async (importOriginal) => ({
  // The real slot, so "the Office is offered" means the actual control rather
  // than a stand-in that could drift from it.
  ...(await importOriginal<typeof import('../../docs-runtime')>()),
  useDocsAssistantEnabled: () => assistantEnabled.value
}))

import DocSidebarDesktopContent from '../DocSidebar/Desktop/Content'

const sidebar = () =>
  render(<DocSidebarDesktopContent path="/architecture/packages-concept" sidebar={[]} />)

afterEach(() => {
  assistantEnabled.value = true
})

describe('swizzled DocSidebar/Desktop/Content', () => {
  it('renders the theme’s own navigation and adds the Office after it', () => {
    const { container } = sidebar()

    const nav = screen.getByTestId('theme-original-doc-sidebar-content')
    const office = screen.getByRole('region', { name: 'Agent office' })
    expect(nav).toBeInTheDocument()
    // After, not inside: theme-classic's sidebar is a flex column whose nav is
    // the `flex-grow: 1` child, so the Office lands at the bottom at its own
    // height rather than scrolling with the navigation.
    expect(nav.compareDocumentPosition(office) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.contains(nav)).toBe(true)
  })

  it('offers nothing when the assistant is rolled back', () => {
    assistantEnabled.value = false

    sidebar()

    expect(screen.getByTestId('theme-original-doc-sidebar-content')).toBeInTheDocument()
    // A control for a runtime that can never start would be worse than absent.
    expect(screen.queryByRole('region', { name: 'Agent office' })).not.toBeInTheDocument()
  })
})
