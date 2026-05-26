// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantContent } from '../src/assistant-content.js'
import { resetMermaidState } from '@tinytinkerer/content-mermaid'

const mockInitialize = vi.hoisted(() => vi.fn())
const mockRender = vi.hoisted(() => vi.fn(() => Promise.resolve({ svg: '<svg><text>Diagram</text></svg>' })))
const mermaidWindow = window as unknown as Window & {
  mermaid?: {
    initialize: (...args: unknown[]) => void
    render: (...args: unknown[]) => Promise<{ svg: string }>
  }
}

const FLOWCHART_CODE = [
  'flowchart TD',
  '    A[Start] --> B{Is it working?}',
  '    B -- Yes --> C[Great!]',
  '    B -- No --> D[Check the logs]',
  '    D --> E[Fix the issue]',
  '    E --> B'
].join('\n')

const HELLO_WORLD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Hello World Wireframe</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      height: 100vh;
      justify-content: center;
      align-items: center;
      margin: 0;
      background: #f0f0f0;
      border: 2px dashed #ccc;
    }
  </style>
</head>
<body>
  <h1>Hello World</h1>
</body>
</html>`

beforeEach(() => {
  mockInitialize.mockReset()
  mockRender.mockReset()
  mermaidWindow.mermaid = {
    initialize: mockInitialize,
    render: mockRender
  }
})

afterEach(() => {
  cleanup()
  resetMermaidState()
  delete mermaidWindow.mermaid
})

describe('AssistantContent', () => {
  it('renders markdown, tables, and images through app-browser composition', () => {
    render(
      <AssistantContent
        content={[
          '# Heading',
          '',
          '| Name | Role |',
          '| --- | --- |',
          '| Ada | Admin |',
          '',
          '![Diagram](https://example.com/diagram.png)'
        ].join('\n')}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Diagram' })).toBeInTheDocument()
  })

  it('propagates shell styling hooks', () => {
    const { container } = render(
      <AssistantContent content="streaming..." className="prose-assistant" isStreaming />
    )

    expect(container.firstChild).toHaveClass('tt-markdown')
    expect(container.firstChild).toHaveClass('tt-markdown--streaming')
    expect(container.firstChild).toHaveClass('prose-assistant')
  })

  it('renders mermaid fences through the specialized renderer', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })

    render(
      <AssistantContent content={['```mermaid', FLOWCHART_CODE, '```'].join('\n')} />
    )

    await waitFor(() => {
      expect(document.querySelector('svg')).not.toBeNull()
    })

    expect(mockRender).toHaveBeenCalledWith(
      expect.stringContaining('tt-mermaid'),
      FLOWCHART_CODE
    )
  })

  it('renders wireframe fences through the specialized renderer', async () => {
    render(
      <AssistantContent content={['```wireframe', HELLO_WORLD_HTML, '```'].join('\n')} />
    )

    await waitFor(() => {
      expect(document.querySelector('[data-tt-wireframe]')).not.toBeNull()
    })

    const iframe = document.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('srcdoc')).toBe(HELLO_WORLD_HTML)
  })

  it('renders mermaid first then wireframe without passing wireframe HTML to mermaid', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Start</text></svg>' })

    render(
      <AssistantContent
        content={[
          '```mermaid',
          FLOWCHART_CODE,
          '```',
          '',
          '```wireframe',
          HELLO_WORLD_HTML,
          '```'
        ].join('\n')}
      />
    )

    await waitFor(() => {
      expect(document.querySelector('svg')).not.toBeNull()
      expect(document.querySelector('[data-tt-wireframe]')).not.toBeNull()
    })

    // mermaid.render must only have been called with the mermaid flowchart, never with wireframe HTML
    for (const call of mockRender.mock.calls as unknown[][]) {
      const code = String(call[1])
      expect(code).not.toContain('<!DOCTYPE html>')
      expect(code).not.toContain('<h1>')
    }
  })

  it('renders wireframe first then mermaid without interference', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Start</text></svg>' })

    render(
      <AssistantContent
        content={[
          '```wireframe',
          HELLO_WORLD_HTML,
          '```',
          '',
          '```mermaid',
          FLOWCHART_CODE,
          '```'
        ].join('\n')}
      />
    )

    await waitFor(() => {
      expect(document.querySelector('[data-tt-wireframe]')).not.toBeNull()
      expect(document.querySelector('svg')).not.toBeNull()
    })

    expect(mockRender).toHaveBeenCalledWith(
      expect.stringContaining('tt-mermaid'),
      FLOWCHART_CODE
    )
  })

  it('preserves DOM order for mixed node types', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })

    const { container } = render(
      <AssistantContent
        content={[
          '# Title',
          '',
          '```mermaid',
          'graph TD',
          'A-->B',
          '```',
          '',
          'Some text',
          '',
          '![img](https://example.com/img.png)'
        ].join('\n')}
      />
    )

    await waitFor(() => {
      expect(container.querySelector('svg')).not.toBeNull()
    })

    const heading = container.querySelector('h1')
    const svg = container.querySelector('svg')
    const img = container.querySelector('img')

    expect(heading).not.toBeNull()
    expect(svg).not.toBeNull()
    expect(img).not.toBeNull()

    // Node.DOCUMENT_POSITION_FOLLOWING (4) means the argument comes after the receiver
    expect(heading!.compareDocumentPosition(svg!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(svg!.compareDocumentPosition(img!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
