// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRenderMermaidSource = vi.hoisted(() => vi.fn())

vi.mock('@tinytinkerer/content-mermaid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tinytinkerer/content-mermaid')>()
  return {
    ...actual,
    renderMermaidSource: mockRenderMermaidSource
  }
})

import ExportModal from '../src/export-modal'

const FILENAME_PATTERN = /^tinytinkerer-\d{4}-\d{2}-\d{2}-\d{6}$/

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  mockRenderMermaidSource.mockReset()
  mockRenderMermaidSource.mockResolvedValue({ svg: '<svg viewBox="0 0 100 50"><g/></svg>' })
})

describe('ExportModal', () => {
  it('renders with PNG selected, transparent checked, dark unchecked, and a prefilled filename', async () => {
    render(<ExportModal source="flowchart TD\nA-->B" onClose={vi.fn()} />)

    await waitFor(() => expect(mockRenderMermaidSource).toHaveBeenCalled())

    expect(screen.getByRole('radio', { name: 'PNG' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'SVG' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Transparent background' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Dark mode' })).not.toBeChecked()
    const filenameInput = screen.getByDisplayValue<HTMLInputElement>(FILENAME_PATTERN)
    expect(filenameInput.value).toMatch(FILENAME_PATTERN)
  })

  it('calls renderMermaidSource with the dark theme when Dark mode is toggled', async () => {
    render(<ExportModal source="flowchart TD\nA-->B" onClose={vi.fn()} />)

    await waitFor(() => expect(mockRenderMermaidSource).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Dark mode' }))

    await waitFor(() => expect(mockRenderMermaidSource).toHaveBeenCalledTimes(2))
    expect(mockRenderMermaidSource).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.any(String),
      { theme: 'dark' }
    )
  })

  it('shows an alert and disables export when renderMermaidSource rejects', async () => {
    mockRenderMermaidSource.mockReset()
    mockRenderMermaidSource.mockRejectedValue(new Error('Parse error on line 1'))

    render(<ExportModal source="bad syntax" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Parse error on line 1')
    })
    expect(screen.getByRole('button', { name: 'Export PNG' })).toBeDisabled()
  })

  it('disables the clipboard radio when ClipboardItem is undefined', async () => {
    const original = (globalThis as { ClipboardItem?: unknown }).ClipboardItem
    delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem

    render(<ExportModal source="flowchart TD\nA-->B" onClose={vi.fn()} />)
    await waitFor(() => expect(mockRenderMermaidSource).toHaveBeenCalled())

    expect(screen.getByRole('radio', { name: /Copy to clipboard/ })).toBeDisabled()

    if (original) (globalThis as { ClipboardItem?: unknown }).ClipboardItem = original
  })

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn()
    render(<ExportModal source="flowchart TD\nA-->B" onClose={onClose} />)
    await waitFor(() => expect(mockRenderMermaidSource).toHaveBeenCalled())

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicking the backdrop but not when clicking inside the dialog', async () => {
    const onClose = vi.fn()
    render(<ExportModal source="flowchart TD\nA-->B" onClose={onClose} />)
    await waitFor(() => expect(mockRenderMermaidSource).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('exports SVG with a sanitized filename and closes the modal', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    let downloadAttr = ''
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloadAttr = this.getAttribute('download') ?? ''
    })
    const onClose = vi.fn()

    render(<ExportModal source="flowchart TD\nA-->B" onClose={onClose} />)
    await waitFor(() => expect(mockRenderMermaidSource).toHaveBeenCalled())

    const filenameInput = screen.getByDisplayValue<HTMLInputElement>(FILENAME_PATTERN)
    fireEvent.change(filenameInput, { target: { value: 'my/diag:v2' } })
    fireEvent.click(screen.getByRole('radio', { name: 'SVG' }))

    fireEvent.click(screen.getByRole('button', { name: 'Export SVG' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))

    expect(downloadAttr).toBe('mydiagv2.svg')
    expect(clickSpy).toHaveBeenCalled()

    clickSpy.mockRestore()
  })
})
