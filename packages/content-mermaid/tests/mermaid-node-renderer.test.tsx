// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockInitialize = vi.hoisted(() => vi.fn())
const mockRender = vi.hoisted(() => vi.fn())

import { MermaidNodeRenderer, mermaidRenderers, resetMermaidState } from '../src/index.js'

const FLOWCHART_CODE = [
  'flowchart TD',
  '    A[Start] --> B{Is it working?}',
  '    B -- Yes --> C[Great!]',
  '    B -- No --> D[Check the logs]',
  '    D --> E[Fix the issue]',
  '    E --> B'
].join('\n')

afterEach(() => {
  cleanup()
  resetMermaidState()
  delete window.mermaid
})

beforeEach(() => {
  mockInitialize.mockReset()
  mockRender.mockReset()
  window.mermaid = {
    initialize: mockInitialize,
    render: mockRender
  }
})

describe('MermaidNodeRenderer', () => {
  it('exports the mermaid renderer map for composition', () => {
    expect(mermaidRenderers.mermaid).toBe(MermaidNodeRenderer)
  })

  it('renders svg output after the mermaid runtime loads', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })

    const { container } = render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Mermaid diagram')).toBeInTheDocument()
    })

    expect(mockInitialize).toHaveBeenCalledTimes(1)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('renders a flowchart diagram and passes the code verbatim to the runtime', async () => {
    mockRender.mockResolvedValue({
      svg: '<svg><text>Start</text><text>Is it working?</text><text>Great!</text></svg>'
    })

    const { container } = render(
      <MermaidNodeRenderer node={{ type: 'mermaid', code: FLOWCHART_CODE }} />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Mermaid diagram')).toBeInTheDocument()
    })

    expect(mockRender).toHaveBeenCalledWith(
      expect.stringContaining('tt-mermaid'),
      FLOWCHART_CODE
    )
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('falls back to a code block when mermaid rendering fails', async () => {
    mockRender.mockRejectedValue(new Error('render failed'))

    const { container } = render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />)

    await waitFor(() => {
      expect(container.querySelector('code')?.textContent).toBe('graph TD\nA-->B')
    })
  })

  it('logs the error when mermaid rendering fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRender.mockRejectedValue(new Error('parse error'))

    render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'invalid mermaid syntax %%' }} />)

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[content-mermaid]'),
        expect.any(Error)
      )
    })

    consoleSpy.mockRestore()
  })

  it('always shows the chrome wrapper and Mermaid label', () => {
    mockRender.mockResolvedValue({ svg: '<svg />' })

    render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />)

    expect(screen.getByText('Mermaid')).toBeInTheDocument()
  })

  it('shows Preview and Code buttons when render succeeds', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })

    render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument()
  })

  it('hides the Preview button when rendering fails', async () => {
    mockRender.mockRejectedValue(new Error('render failed'))

    render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'bad syntax' }} />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    })
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument()
  })

  it('switches to code view when Code is clicked', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })

    const { container } = render(
      <MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />
    )

    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))

    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('graph TD\nA-->B')
  })

  it('shows a Copy button that writes the mermaid source to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    mockRender.mockResolvedValue({ svg: '<svg />' })

    render(<MermaidNodeRenderer node={{ type: 'mermaid', code: 'graph TD\nA-->B' }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('graph TD\nA-->B')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument())
  })
})
