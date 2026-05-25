// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantContent } from '../src/assistant-content.js'

const mockInitialize = vi.hoisted(() => vi.fn())
const mockRender = vi.hoisted(() => vi.fn(() => Promise.resolve({ svg: '<svg><text>Diagram</text></svg>' })))
const mermaidWindow = window as unknown as Window & {
  mermaid?: {
    initialize: (...args: unknown[]) => void
    render: (...args: unknown[]) => Promise<{ svg: string }>
  }
}

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
    render(
      <AssistantContent content={['```mermaid', 'graph TD', 'A-->B', '```'].join('\n')} />
    )

    await waitFor(() => {
      expect(document.querySelector('svg')).not.toBeNull()
    })
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
