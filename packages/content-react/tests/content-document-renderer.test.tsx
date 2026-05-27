// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { lazy, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ContentDocumentRenderer,
  createReactContentRuntime,
  MARKDOWN_ROOT_CLASS,
  MARKDOWN_STREAMING_CLASS,
  PreviewCodeFrame,
  REACT_SSR_EXECUTION_POLICY,
  TableNodeView,
  tableToMarkdown
} from '../src/index.js'

afterEach(() => {
  cleanup()
})

describe('ContentDocumentRenderer', () => {
  it('exports a conservative SSR execution policy preset', () => {
    expect(REACT_SSR_EXECUTION_POLICY).toEqual({
      allowLazy: false,
      allowClientOnly: false,
      allowDom: false
    })
  })

  it('adds the shared markdown root class and streaming class', () => {
    const { container } = render(
      <ContentDocumentRenderer
        isStreaming
        document={{
          nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hello' }] }]
        }}
      />
    )

    expect(container.firstChild).toHaveClass(MARKDOWN_ROOT_CLASS)
    expect(container.firstChild).toHaveClass(MARKDOWN_STREAMING_CLASS)
  })

  it('renders default semantic nodes, code blocks, tables, and images', () => {
    render(
      <ContentDocumentRenderer
        document={{
          nodes: [
            {
              type: 'heading',
              level: 1,
              children: [{ type: 'text', value: 'Heading' }]
            },
            { type: 'codeBlock', code: 'const answer = 42', language: 'ts' },
            {
              type: 'table',
              align: ['left', 'right'],
              header: [
                [{ type: 'text', value: 'Name' }],
                [{ type: 'text', value: 'Role' }]
              ],
              rows: [
                [
                  [{ type: 'text', value: 'Ada' }],
                  [{ type: 'text', value: 'Admin' }]
                ]
              ]
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
              header: [
                [{ type: 'text', value: 'Name' }],
                [{ type: 'text', value: 'Role' }]
              ],
              rows: [
                [
                  [{ type: 'text', value: 'Ada' }],
                  [{ type: 'text', value: 'Admin' }]
                ]
              ]
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
        document={{ nodes: [{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }] }}
      />
    )

    expect(screen.getByText(/graph TD/)).toBeInTheDocument()
  })

  it('falls back when a specialized renderer throws', () => {
    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:wireframe',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'wireframe',
      render: () => {
        throw new Error('boom')
      }
    })

    render(
      <ContentDocumentRenderer
        runtime={runtime}
        document={{ nodes: [{ type: 'codeBlock', code: '[Button]', language: 'wireframe' }] }}
      />
    )

    expect(screen.getByText('[Button]')).toBeInTheDocument()
  })

  it('keeps default renderers while adding custom plugins through the supplied runtime', () => {
    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:mermaid',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'mermaid',
      render: (node) => <div>Diagram: {node.code}</div>
    })

    render(
      <ContentDocumentRenderer
        runtime={runtime}
        document={{
          nodes: [
            {
              type: 'heading',
              level: 1,
              children: [{ type: 'text', value: 'Heading' }]
            },
            { type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }
          ]
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
    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:lazy-mermaid',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'mermaid',
      render: (node) => <LazyMermaidRenderer node={node} />
    })

    const { container } = render(
      <ContentDocumentRenderer
        runtime={runtime}
        document={{
          nodes: [
            { type: 'paragraph', children: [{ type: 'text', value: 'Before' }] },
            { type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' },
            { type: 'paragraph', children: [{ type: 'text', value: 'After' }] }
          ]
        }}
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

  it('renders semantic block nodes (heading, paragraph, list, blockquote)', () => {
    render(
      <ContentDocumentRenderer
        document={{
          nodes: [
            {
              type: 'heading',
              level: 2,
              children: [{ type: 'text', value: 'Outline' }]
            },
            {
              type: 'paragraph',
              children: [
                { type: 'text', value: 'See ' },
                { type: 'strong', children: [{ type: 'text', value: 'docs' }] }
              ]
            },
            {
              type: 'list',
              ordered: false,
              children: [
                {
                  type: 'listItem',
                  children: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', value: 'first' }]
                    }
                  ]
                }
              ]
            },
            {
              type: 'blockquote',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'text', value: 'quoted' }]
                }
              ]
            }
          ]
        }}
      />
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Outline' })).toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('quoted')).toBeInTheDocument()
  })

  it('uses a custom plugin registered against an externally supplied runtime', () => {
    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:mermaid',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'mermaid',
      render: (node) => <div data-testid="custom-mermaid">{node.code}</div>
    })

    render(
      <ContentDocumentRenderer
        runtime={runtime}
        document={{ nodes: [{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }] }}
      />
    )

    expect(screen.getByTestId('custom-mermaid')).toHaveTextContent('graph TD')
  })

  it('falls back to generic code rendering when execution policy blocks a browser-only plugin', () => {
    const runtime = createReactContentRuntime({
      executionPolicy: {
        allowDom: false
      }
    })
    runtime.register({
      id: 'test:blocked-wireframe',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'wireframe',
      requirements: { clientOnly: true, needsDom: true },
      render: (node) => <div>blocked: {node.code}</div>
    })

    render(
      <ContentDocumentRenderer
        runtime={runtime}
        document={{ nodes: [{ type: 'codeBlock', code: '<html />', language: 'wireframe' }] }}
      />
    )

    expect(screen.queryByText(/blocked:/)).toBeNull()
    expect(screen.getByText('<html />')).toBeInTheDocument()
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
          header: [
            [{ type: 'text', value: 'Name' }],
            [{ type: 'text', value: 'Role' }],
            [{ type: 'text', value: 'Score' }]
          ],
          rows: [
            [
              [{ type: 'text', value: 'Ada' }],
              [{ type: 'text', value: 'Admin' }],
              [{ type: 'text', value: '3' }]
            ]
          ]
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
        header: [
          [{ type: 'text', value: 'Name' }],
          [{ type: 'text', value: 'Role' }],
          [{ type: 'text', value: 'Score' }]
        ],
        rows: [
          [
            [{ type: 'text', value: 'Ada' }],
            [{ type: 'text', value: 'Admin' }],
            [{ type: 'text', value: '3' }]
          ]
        ]
      })
    ).toBe(['| Name | Role | Score |', '| :--- | ---: | :---: |', '| Ada | Admin | 3 |'].join('\n'))
  })
})
