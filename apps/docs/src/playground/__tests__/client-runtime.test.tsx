import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentDocument } from '@tinytinkerer/app-browser'
import { DEFAULT_PLAYGROUND_EXAMPLE_ID, findPlaygroundExample } from '../constants'

vi.mock('@tinytinkerer/app-browser/styles.css', () => ({}))

const parsePlaygroundMarkdown = vi.fn(
  (markdown: string): ContentDocument => ({
    nodes: [
      {
        type: 'paragraph',
        id: 'node-1',
        children: [{ type: 'text', id: 'text-1', value: markdown }]
      }
    ]
  })
)
const resolvePlaygroundNodePlugin = vi.fn(
  (node: unknown): { ok: true; pluginId: string; nodeType: 'paragraph' } => {
    void node
    return { ok: true, pluginId: 'core:paragraph', nodeType: 'paragraph' }
  }
)
const copy = vi.fn()
const useCopyButtonState = vi.fn((value: string): { copied: boolean; copy: () => void } => {
  void value
  return { copied: false, copy }
})

vi.mock('@tinytinkerer/app-browser', () => ({
  parsePlaygroundMarkdown: (markdown: string) => parsePlaygroundMarkdown(markdown),
  resolvePlaygroundNodePlugin: (node: unknown) => resolvePlaygroundNodePlugin(node),
  useCopyButtonState: (value: string) => useCopyButtonState(value),
  ContentPlaygroundPreview: ({ document }: { document: ContentDocument }) => {
    const node = document.nodes[0] as unknown as { children: [{ value: string }] } | undefined
    return <div data-testid="preview">{node?.children[0]?.value}</div>
  }
}))

beforeEach(() => {
  parsePlaygroundMarkdown.mockClear()
  resolvePlaygroundNodePlugin.mockClear()
  copy.mockClear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
})

describe('PlaygroundClientRuntime', () => {
  it('renders the default example source and its parsed preview without any network call', async () => {
    const { default: PlaygroundClientRuntime } = await import('../client-runtime')
    render(<PlaygroundClientRuntime title="Rich content playground" />)

    const defaultExample = findPlaygroundExample(DEFAULT_PLAYGROUND_EXAMPLE_ID)!
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Source')
    expect(textarea.value).toBe(defaultExample.markdown)
    expect(screen.getByTestId('preview')).toHaveTextContent(
      defaultExample.markdown.split('\n')[0].slice(0, 10)
    )
  })

  it('re-parses on every keystroke and updates the preview, with no debounce/model call', async () => {
    const user = userEvent.setup()
    const { default: PlaygroundClientRuntime } = await import('../client-runtime')
    render(<PlaygroundClientRuntime title="Rich content playground" />)

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Source')
    await user.clear(textarea)
    await user.type(textarea, 'hello world')

    expect(textarea.value).toBe('hello world')
    expect(screen.getByTestId('preview')).toHaveTextContent('hello world')
    expect(parsePlaygroundMarkdown).toHaveBeenCalledWith('hello world')
  })

  it('switching the example picker replaces the source and updates the shareable URL, without ever carrying free-text source', async () => {
    const user = userEvent.setup()
    const { default: PlaygroundClientRuntime } = await import('../client-runtime')
    render(<PlaygroundClientRuntime title="Rich content playground" />)

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Source')
    await user.clear(textarea)
    await user.type(textarea, 'my own edit')

    await user.selectOptions(screen.getByLabelText('Example'), 'table')

    const tableExample = findPlaygroundExample('table')!
    expect(textarea.value).toBe(tableExample.markdown)
    expect(window.location.search).toBe('?example=table')
  })

  it('reset restores the selected example source after free-form edits', async () => {
    const user = userEvent.setup()
    const { default: PlaygroundClientRuntime } = await import('../client-runtime')
    render(<PlaygroundClientRuntime title="Rich content playground" />)

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Source')
    const original = textarea.value
    await user.type(textarea, '\nextra text')
    expect(textarea.value).not.toBe(original)

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(textarea.value).toBe(original)
  })

  it('the copy-source button reuses the shared copy-button hook', async () => {
    const user = userEvent.setup()
    const { default: PlaygroundClientRuntime } = await import('../client-runtime')
    render(<PlaygroundClientRuntime title="Rich content playground" />)

    await user.click(screen.getByRole('button', { name: /copy source/i }))
    expect(copy).toHaveBeenCalledTimes(1)
  })

  it('preselects the example named in the ?example= URL param on mount', async () => {
    window.history.replaceState(null, '', '/?example=mermaid')
    const { default: PlaygroundClientRuntime } = await import('../client-runtime')
    render(<PlaygroundClientRuntime title="Rich content playground" />)

    const mermaidExample = findPlaygroundExample('mermaid')!
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Source')
    expect(textarea.value).toBe(mermaidExample.markdown)
  })
})
