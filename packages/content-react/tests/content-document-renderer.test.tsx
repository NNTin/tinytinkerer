// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { lazy, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MermaidNode } from '@tinytinkerer/content-core'
import {
  ContentDocumentRenderer,
  MARKDOWN_ROOT_CLASS,
  MARKDOWN_STREAMING_CLASS,
  PreviewCodeFrame,
  TableNodeView,
  tableToMarkdown
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

  it('copies table nodes using the shared markdown serializer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(
      <ContentDocumentRenderer
        document={{
          nodes: [
            {
              type: 'table',
              align: ['left', 'right'],
              header: ['Name', 'Role'],
              rows: [['Ada', 'Admin']]
            }
          ]
        }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith([
      '| Name | Role |',
      '| :--- | ---: |',
      '| Ada | Admin |'
    ].join('\n'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument())
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

  it('merges partial renderer overrides with the default renderers', () => {
    render(
      <ContentDocumentRenderer
        document={{
          nodes: [
            { type: 'markdown', markdown: '# Heading' },
            { type: 'mermaid', code: 'graph TD\nA-->B' }
          ]
        }}
        renderers={{
          mermaid: ({ node }: { node: MermaidNode }) => <div>Diagram: {node.code}</div>
        }}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText(/Diagram: graph TD/)).toBeInTheDocument()
  })

  it('keeps surrounding content rendered while a lazy specialized renderer is pending', async () => {
    type LazyRendererModule = {
      default: ({ node }: { node: { code: string } }) => ReactElement
    }

    let resolveRenderer: ((value: LazyRendererModule) => void) | undefined
    const LazyMermaidRenderer = lazy(
      () =>
        new Promise<LazyRendererModule>((resolve) => {
          resolveRenderer = resolve
        })
    )

    const { container } = render(
      <ContentDocumentRenderer
        document={{
          nodes: [
            { type: 'markdown', markdown: 'Before' },
            { type: 'mermaid', code: 'graph TD\nA-->B' },
            { type: 'markdown', markdown: 'After' }
          ]
        }}
        renderers={{ mermaid: LazyMermaidRenderer }}
      />
    )

    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
    expect(container.querySelector('code')?.textContent).toBe('graph TD\nA-->B')

    resolveRenderer?.({
      default: ({ node }) => <div>Loaded: {node.code}</div>
    })

    await waitFor(() => expect(screen.getByText(/Loaded: graph TD/)).toBeInTheDocument())
  })

  it('renders choicePrompt nodes without crashing when no renderer is registered', () => {
    const { container } = render(
      <ContentDocumentRenderer
        document={{
          nodes: [{ type: 'choicePrompt', prompt: 'Pick one', choices: ['A', 'B'] }]
        }}
      />
    )

    expect(container.querySelector('pre')).toBeInTheDocument()
  })
})

describe('PreviewCodeFrame', () => {
  it('switches between preview and code views and copies source', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const { container } = render(
      <PreviewCodeFrame
        headerStart={<span>Example</span>}
        code={'const answer = 42'}
        codeLanguage="ts"
        preview={<div>Preview body</div>}
      />
    )

    expect(screen.getByText('Preview body')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))

    expect(container.querySelector('code')?.textContent).toBe('const answer = 42')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith('const answer = 42')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument())
  })
})

describe('TableNodeView', () => {
  it('renders semantic table markup from a TableNode', () => {
    const { container } = render(
      <TableNodeView
        node={{
          type: 'table',
          align: ['left', 'right', 'center'],
          header: ['Name', 'Role', 'Score'],
          rows: [['Ada', 'Admin', '3']]
        }}
      />
    )

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('align', 'left')
    expect(screen.getByRole('columnheader', { name: 'Role' })).toHaveAttribute('align', 'right')
    expect(container.querySelector('td[align="center"]')?.textContent).toBe('3')
  })

  it('serializes aligned tables back to markdown', () => {
    expect(
      tableToMarkdown({
        type: 'table',
        align: ['left', 'right', 'center'],
        header: ['Name', 'Role', 'Score'],
        rows: [['Ada', 'Admin', '3']]
      })
    ).toBe(['| Name | Role | Score |', '| :--- | ---: | :---: |', '| Ada | Admin | 3 |'].join('\n'))
  })
})
