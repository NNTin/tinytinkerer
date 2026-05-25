// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ContentDocumentRenderer,
  MARKDOWN_ROOT_CLASS,
  MARKDOWN_STREAMING_CLASS
} from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('ContentDocumentRenderer', () => {
  it('adds the shared markdown root class and streaming class', () => {
    const { container } = render(
      <ContentDocumentRenderer
        isStreaming
        document={{ nodes: [{ type: 'markdown', markdown: 'Hello' }] }}
      />
    )

    expect(container.firstChild).toHaveClass(MARKDOWN_ROOT_CLASS)
    expect(container.firstChild).toHaveClass(MARKDOWN_STREAMING_CLASS)
  })

  it('renders default markdown, code blocks, tables, and images', () => {
    render(
      <ContentDocumentRenderer
        document={{
          nodes: [
            { type: 'markdown', markdown: '# Heading' },
            { type: 'codeBlock', code: 'const answer = 42', language: 'ts' },
            {
              type: 'table',
              align: ['left', 'right'],
              header: ['Name', 'Role'],
              rows: [['Ada', 'Admin']]
            },
            { type: 'image', url: 'https://example.com/test.png', alt: 'Test image' }
          ]
        }}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('const answer = 42')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Test image' })).toBeInTheDocument()
  })

  it('falls back when a specialized renderer is missing', () => {
    render(
      <ContentDocumentRenderer
        document={{ nodes: [{ type: 'mermaid', code: 'graph TD\nA-->B' }] }}
      />
    )

    expect(screen.getByText(/graph TD/)).toBeInTheDocument()
  })

  it('falls back when a specialized renderer throws', () => {
    render(
      <ContentDocumentRenderer
        document={{ nodes: [{ type: 'wireframe', code: '[Button]' }] }}
        renderers={{
          wireframe: () => {
            throw new Error('boom')
          }
        }}
      />
    )

    expect(screen.getByText('[Button]')).toBeInTheDocument()
  })
})
