// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PermissionModal } from '../src/permission-modal.js'
import { requestPermission, resetPermissionStore } from '../src/permission-service.js'

afterEach(() => {
  resetPermissionStore()
  cleanup()
})

const baseRequest = {
  toolId: 'web-search',
  input: { query: 'cats' },
  stepId: 'step-1'
}

describe('PermissionModal', () => {
  it('renders nothing while no permission is pending', () => {
    render(<PermissionModal />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows the tool and input, and resolves allow when Allow is clicked', async () => {
    render(<PermissionModal />)

    const decision = requestPermission(baseRequest)

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('web-search')
    expect(dialog).toHaveTextContent('cats')

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    await expect(decision).resolves.toEqual({ allow: true })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('resolves deny with a reason when Deny is clicked', async () => {
    render(<PermissionModal />)

    const decision = requestPermission(baseRequest)
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))

    const result = await decision
    expect(result.allow).toBe(false)
    expect((result as { allow: false; reason: string }).reason).toBe('Denied by user')
  })

  it('denies when the overlay is clicked', async () => {
    render(<PermissionModal />)

    const decision = requestPermission(baseRequest)
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: 'Deny tool' }))

    const result = await decision
    expect(result.allow).toBe(false)
  })

  it('processes a second pending request after the first is settled', async () => {
    render(<PermissionModal />)

    const first = requestPermission(baseRequest)
    const second = requestPermission({ ...baseRequest, toolId: 'mcp:files:read' })

    // Only the head-of-queue request is shown.
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('web-search')

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await expect(first).resolves.toEqual({ allow: true })

    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('mcp:files:read'))

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    const secondResult = await second
    expect(secondResult.allow).toBe(false)
  })
})
