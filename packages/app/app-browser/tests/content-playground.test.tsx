// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMermaidState } from '@tinytinkerer/content-mermaid'
import {
  ContentPlaygroundPreview,
  PLAYGROUND_ERROR_DEMO_LANGUAGE,
  parsePlaygroundMarkdown,
  resolvePlaygroundNodePlugin
} from '../src/content-playground.js'

const mockInitialize = vi.hoisted(() => vi.fn())
const mockRender = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ svg: '<svg><text>Diagram</text></svg>' }))
)
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
  resetMermaidState()
  delete mermaidWindow.mermaid
})

describe('parsePlaygroundMarkdown', () => {
  it('parses markdown into a normalized ContentDocument without any network call', () => {
    const document = parsePlaygroundMarkdown('# Title\n\nSome *text*.')
    expect(document.nodes[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(document.nodes[0]?.id).toBeTruthy()
  })
})

describe('resolvePlaygroundNodePlugin', () => {
  it('resolves default core plugins for plain prose', () => {
    const document = parsePlaygroundMarkdown('# Title')
    const heading = document.nodes[0]
    expect(heading).toBeDefined()
    expect(resolvePlaygroundNodePlugin(heading!)).toEqual({
      ok: true,
      pluginId: 'core:heading',
      nodeType: 'heading'
    })
  })

  it.each([
    ['```mermaid\ngraph TD\nA-->B\n```', 'mermaid'],
    ['```wireframe\n<h1>Hi</h1>\n```', 'wireframe'],
    ['```js\nconsole.log(1)\n```', 'code'],
    [`\`\`\`${PLAYGROUND_ERROR_DEMO_LANGUAGE}\nboom\n\`\`\``, 'playground-error-demo']
  ])('resolves the %s fence to the %s plugin', (markdown, expectedPluginId) => {
    const document = parsePlaygroundMarkdown(markdown)
    const node = document.nodes[0]
    expect(node).toBeDefined()
    const resolution = resolvePlaygroundNodePlugin(node!)
    expect(resolution).toMatchObject({ ok: true, pluginId: expectedPluginId })
  })

  it('resolves a callout blockquote to the callout plugin', () => {
    const document = parsePlaygroundMarkdown('> [!TIP]\n> Use the playground.')
    const node = document.nodes[0]
    expect(node).toBeDefined()
    expect(resolvePlaygroundNodePlugin(node!)).toMatchObject({ ok: true, pluginId: 'callout' })
  })

  it('resolves a standalone link paragraph to the link-card plugin', () => {
    const document = parsePlaygroundMarkdown('https://example.com')
    const node = document.nodes[0]
    expect(node).toBeDefined()
    expect(resolvePlaygroundNodePlugin(node!)).toMatchObject({ ok: true, pluginId: 'link-card' })
  })

  it('resolves a table to the table plugin and a standalone image to the image plugin', () => {
    const document = parsePlaygroundMarkdown(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', '![alt](https://example.com/x.png)'].join(
        '\n'
      )
    )
    const [table, image] = document.nodes
    expect(table).toBeDefined()
    expect(image).toBeDefined()
    expect(resolvePlaygroundNodePlugin(table!)).toMatchObject({ ok: true, pluginId: 'table' })
    expect(resolvePlaygroundNodePlugin(image!)).toMatchObject({ ok: true, pluginId: 'image' })
  })
})

describe('ContentPlaygroundPreview', () => {
  it('renders the real specialized renderers for mermaid and wireframe fences', async () => {
    mockRender.mockResolvedValue({ svg: '<svg><text>Diagram</text></svg>' })

    render(
      <ContentPlaygroundPreview
        document={parsePlaygroundMarkdown(
          ['```mermaid', 'graph TD', 'A-->B', '```', '', '```wireframe', '<h1>Hi</h1>', '```'].join(
            '\n'
          )
        )}
      />
    )

    await waitFor(() => {
      expect(document.querySelector('svg')).not.toBeNull()
      expect(document.querySelector('[data-tt-wireframe]')).not.toBeNull()
    })
  })

  it('contains a genuine render-time throw from the demo plugin behind the fallback boundary', () => {
    render(
      <ContentPlaygroundPreview
        document={parsePlaygroundMarkdown(
          [`\`\`\`${PLAYGROUND_ERROR_DEMO_LANGUAGE}`, 'boom', '```'].join('\n')
        )}
      />
    )

    // The runtime's RendererBoundary swaps in the generic code-block fallback
    // instead of letting the render-phase throw propagate out of this test.
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
