// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { lazy, type ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assignNodeIds,
  ContentDocumentContent,
  ContentDocumentRenderer,
  type ContentDocument,
  createReactContentRuntime,
  MARKDOWN_ROOT_CLASS,
  MARKDOWN_STREAMING_CLASS,
  PreviewCodeFrame,
  REACT_SSR_EXECUTION_POLICY,
  setContentRenderErrorReporter,
  type ContentRenderErrorInfo,
  TableNodeView,
  tableToMarkdown
} from '../src/index.js'

afterEach(() => {
  cleanup()
})

const withIds = (document: ContentDocument): ContentDocument => assignNodeIds(document)

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
        document={withIds({
          nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hello' }] }]
        })}
      />
    )

    expect(container.firstChild).toHaveClass(MARKDOWN_ROOT_CLASS)
    expect(container.firstChild).toHaveClass(MARKDOWN_STREAMING_CLASS)
  })

  it('renders default semantic nodes and code blocks', () => {
    render(
      <ContentDocumentRenderer
        document={withIds({
          nodes: [
            {
              type: 'heading',
              level: 1,
              children: [{ type: 'text', value: 'Heading' }]
            },
            { type: 'codeBlock', code: 'const answer = 42', language: 'ts' }
          ]
        })}
      />
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Heading' })).toBeInTheDocument()
    expect(screen.getByText('const answer = 42')).toBeInTheDocument()
  })

  it('falls back when no plugin is registered for a node type', () => {
    const { container } = render(
      <ContentDocumentRenderer
        document={withIds({
          nodes: [{ type: 'image', url: 'https://example.com/test.png', alt: 'Test image' }]
        })}
      />
    )

    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('pre')).toBeInTheDocument()
  })

  it('falls back when a specialized renderer is missing', () => {
    render(
      <ContentDocumentRenderer
        document={withIds({ nodes: [{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }] })}
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
        document={withIds({ nodes: [{ type: 'codeBlock', code: '[Button]', language: 'wireframe' }] })}
      />
    )

    expect(screen.getByText('[Button]')).toBeInTheDocument()
  })

  // A component that throws during React's render phase. Unlike a plugin whose
  // `render()` throws eagerly (caught by the runtime and turned into a fallback),
  // this error escapes into React's renderer and is caught by the RendererBoundary
  // — the path that was previously swallowed by an empty componentDidCatch.
  const ThrowDuringRender = (): ReactElement => {
    throw new Error('boom')
  }

  type Reported = { error: Error; info: ContentRenderErrorInfo }

  it('reports a render-boundary failure to the registered reporter', () => {
    // React logs caught render errors to console.error; silence it so the test
    // output stays clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reported: Reported[] = []
    setContentRenderErrorReporter((error, info) => reported.push({ error, info }))

    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:wireframe',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'wireframe',
      render: () => <ThrowDuringRender />
    })

    try {
      render(
        <ContentDocumentRenderer
          runtime={runtime}
          document={withIds({ nodes: [{ type: 'codeBlock', code: '[Button]', language: 'wireframe' }] })}
        />
      )

      // Fallback still renders, and the failure is no longer swallowed.
      expect(screen.getByText('[Button]')).toBeInTheDocument()
      expect(reported).toHaveLength(1)
      expect(reported[0]?.error).toBeInstanceOf(Error)
      expect(reported[0]?.error.message).toBe('boom')
      expect(reported[0]?.info.reason).toBe('renderFailed')
      expect(reported[0]?.info.nodeType).toBe('codeBlock')
      expect(reported[0]?.info.pluginId).toBe('test:wireframe')
    } finally {
      setContentRenderErrorReporter(null)
      consoleError.mockRestore()
    }
  })

  it('reports an eager plugin render() throw caught at the runtime level', () => {
    const reported: Reported[] = []
    setContentRenderErrorReporter((error, info) => reported.push({ error, info }))

    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:wireframe',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'wireframe',
      render: () => {
        throw new Error('eager boom')
      }
    })

    try {
      render(
        <ContentDocumentRenderer
          runtime={runtime}
          document={withIds({ nodes: [{ type: 'codeBlock', code: '[Button]', language: 'wireframe' }] })}
        />
      )

      // Fallback still renders, and the previously-swallowed eager throw is now
      // reported with structured context (no React component stack on this path).
      expect(screen.getByText('[Button]')).toBeInTheDocument()
      expect(reported).toHaveLength(1)
      expect(reported[0]?.error.message).toBe('eager boom')
      expect(reported[0]?.info.reason).toBe('renderFailed')
      expect(reported[0]?.info.nodeType).toBe('codeBlock')
      expect(reported[0]?.info.pluginId).toBe('test:wireframe')
    } finally {
      setContentRenderErrorReporter(null)
    }
  })

  it('reports when a plugin fallback throws, then still renders the host fallback', () => {
    const reported: Reported[] = []
    setContentRenderErrorReporter((error, info) => reported.push({ error, info }))

    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:wireframe',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'wireframe',
      render: () => {
        throw new Error('render boom')
      },
      fallback: () => {
        throw new Error('fallback boom')
      }
    })

    try {
      render(
        <ContentDocumentRenderer
          runtime={runtime}
          document={withIds({ nodes: [{ type: 'codeBlock', code: '[Button]', language: 'wireframe' }] })}
        />
      )

      // Host fallback still renders. Both the render throw and the fallback throw
      // are reported, with distinct reasons.
      expect(screen.getByText('[Button]')).toBeInTheDocument()
      const reasons = reported.map((entry) => entry.info.reason)
      expect(reasons).toContain('renderFailed')
      expect(reasons).toContain('fallbackFailed')
    } finally {
      setContentRenderErrorReporter(null)
    }
  })

  it('does not break rendering when no reporter is registered', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    setContentRenderErrorReporter(null)

    const runtime = createReactContentRuntime()
    runtime.register({
      id: 'test:wireframe',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'wireframe',
      render: () => <ThrowDuringRender />
    })

    try {
      render(
        <ContentDocumentRenderer
          runtime={runtime}
          document={withIds({ nodes: [{ type: 'codeBlock', code: '[Button]', language: 'wireframe' }] })}
        />
      )

      expect(screen.getByText('[Button]')).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
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
        document={withIds({
          nodes: [
            {
              type: 'heading',
              level: 1,
              children: [{ type: 'text', value: 'Heading' }]
            },
            { type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }
          ]
        })}
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
        document={withIds({
          nodes: [
            { type: 'paragraph', children: [{ type: 'text', value: 'Before' }] },
            { type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' },
            { type: 'paragraph', children: [{ type: 'text', value: 'After' }] }
          ]
        })}
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
        document={withIds({
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
        })}
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
        document={withIds({ nodes: [{ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' }] })}
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
        document={withIds({ nodes: [{ type: 'codeBlock', code: '<html />', language: 'wireframe' }] })}
      />
    )

    expect(screen.queryByText(/blocked:/)).toBeNull()
    expect(screen.getByText('<html />')).toBeInTheDocument()
  })

  it('renders choicePrompt nodes without crashing when no renderer is registered', () => {
    const { container } = render(
      <ContentDocumentRenderer
        document={withIds({
          nodes: [{ type: 'choicePrompt', prompt: 'Pick one', choices: ['A', 'B'] }]
        })}
      />
    )

    expect(container.querySelector('pre')).toBeInTheDocument()
  })
})

describe('ContentDocumentContent', () => {
  it('normalizes hand-built documents before rendering them', () => {
    render(
      <ContentDocumentContent
        document={{
          nodes: [{ type: 'paragraph', children: [{ type: 'text', value: 'Hello adapter' }] }]
        }}
      />
    )

    expect(screen.getByText('Hello adapter')).toBeInTheDocument()
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
