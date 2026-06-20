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

  it('pretty-prints run_javascript code in a CodeMirror view without touching the payload', async () => {
    render(<PermissionModal />)

    const minified = 'const a=1;const b=2;return {a,b};'
    const decision = requestPermission({
      toolId: 'run_javascript',
      input: { code: minified },
      stepId: 'step-js'
    })

    const dialog = await screen.findByRole('alertdialog')
    // Rendered through CodeMirror (syntax highlighting), not the raw JSON <pre>.
    await waitFor(() => expect(dialog.querySelector('.cm-editor')).toBeInTheDocument())
    // The code label is shown and the JSON dump of `code` is not.
    expect(dialog).toHaveTextContent('Code')
    expect(dialog).not.toHaveTextContent('"code"')
    // Formatting (async) re-spaces the minified source for display.
    await waitFor(() => expect(dialog).toHaveTextContent('const a = 1'))

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    // The executed payload is whatever the runtime already holds; the modal only
    // returns the decision. Allow resolves cleanly — the formatting is view-only.
    await expect(decision).resolves.toEqual({ allow: true })
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
