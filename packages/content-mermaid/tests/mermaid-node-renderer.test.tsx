// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockInitialize = vi.hoisted(() => vi.fn())
const mockRender = vi.hoisted(() => vi.fn())
const mockParse = vi.hoisted(() => vi.fn())

import {
  createMermaidPlugin,
  MermaidNodeRenderer,
  mermaidPlugin,
  resetMermaidState
} from '../src/index.js'

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
  mockParse.mockReset()
  // Default to treating syntax as valid so existing render-path tests are unaffected.
  mockParse.mockResolvedValue({ diagramType: 'flowchart' })
  window.mermaid = {
    initialize: mockInitialize,
    parse: mockParse,
    render: mockRender
  }
})

describe('MermaidNodeRenderer', () => {
  it('exports the mermaid plugin for composition', () => {
    expect(mermaidPlugin.nodeType).toBe('codeBlock')
    expect(typeof mermaidPlugin.render).toBe('function')
  })

  it('creates isolated plugin instances on demand', () => {
    const left = createMermaidPlugin()
    const right = createMermaidPlugin()

    expect(left).not.toBe(right)
    expect(left.id).toBe('mermaid')
    expect(right.id).toBe('mermaid')
  })

  it('renders svg output after the mermaid runtime loads', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })
    await mermaidPlugin.load?.()

    const { container } = render(
      <MermaidNodeRenderer node={{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }} />
    )

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
    await mermaidPlugin.load?.()

    const { container } = render(
      <MermaidNodeRenderer node={{ type: 'codeBlock', code: FLOWCHART_CODE, language: 'mermaid' }} />
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
    await mermaidPlugin.load?.()

    const { container } = render(
      <MermaidNodeRenderer node={{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }} />
    )

    await waitFor(() => {
      expect(container.querySelector('code')?.textContent).toBe('graph TD\nA-->B')
    })
  })

  it('logs the error when mermaid rendering fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRender.mockRejectedValue(new Error('parse error'))
    await mermaidPlugin.load?.()

    render(
      <MermaidNodeRenderer
        node={{ type: 'codeBlock', code: 'invalid mermaid syntax %%', language: 'mermaid' }}
      />
    )

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

    render(
      <MermaidNodeRenderer node={{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }} />
    )

    expect(screen.getByText('Mermaid')).toBeInTheDocument()
  })

  it('shows Preview and Code buttons when render succeeds', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })
    await mermaidPlugin.load?.()

    render(
      <MermaidNodeRenderer node={{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }} />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument()
  })

  it('hides the Preview button when rendering fails', async () => {
    mockRender.mockRejectedValue(new Error('render failed'))
    await mermaidPlugin.load?.()

    render(<MermaidNodeRenderer node={{ type: 'codeBlock', code: 'bad syntax', language: 'mermaid' }} />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    })
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument()
  })

  it('switches to code view when Code is clicked', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })
    await mermaidPlugin.load?.()

    const { container } = render(
      <MermaidNodeRenderer node={{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }} />
    )

    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))

    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('code')?.textContent).toBe('graph TD\nA-->B')
  })

  it('skips rendering when parse rejects the syntax (e.g. mid-stream)', async () => {
    mockParse.mockResolvedValue(false)

    render(
      <MermaidNodeRenderer
        node={{ type: 'codeBlock', code: 'graph TD\nA-->', language: 'mermaid' }}
      />
    )

    // Wait long enough for the parse promise to settle without scheduling a render.
    await waitFor(() => expect(mockParse).toHaveBeenCalledTimes(1))
    expect(mockRender).not.toHaveBeenCalled()
    // Preview button stays available; we want render to take over the moment
    // streaming completes with valid syntax.
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.queryByText(/Syntax error/i)).toBeNull()
  })

  it('does not surface mermaid error SVGs when parse fails during streaming', async () => {
    mockParse.mockResolvedValue(false)

    const { container } = render(
      <MermaidNodeRenderer
        node={{ type: 'codeBlock', code: 'sequenceDiagram\nAlice->>', language: 'mermaid' }}
      />
    )

    await waitFor(() => expect(mockParse).toHaveBeenCalledTimes(1))
    // No SVG should ever be injected into the preview when parse fails.
    expect(container.querySelector('svg')).toBeNull()
  })

  it('shows a Copy button that writes the mermaid source to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    mockRender.mockResolvedValue({ svg: '<svg />' })
    await mermaidPlugin.load?.()

    render(
      <MermaidNodeRenderer node={{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('graph TD\nA-->B')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument())
  })
})
