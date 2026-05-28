// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor, act } from '@testing-library/react'
import { ContentDocumentContent, type ContentDocument } from '@tinytinkerer/content-react'
import { EditorView } from '@codemirror/view'
import { codePlugin } from '../src/index'

const key = (scope: string, id: string) => `tt-code-edit:v1:${scope}:${id}`

const doc = (nodes: ContentDocument['nodes']): ContentDocument => ({ nodes })

const findEditorView = (container: HTMLElement): EditorView => {
  const dom = container.querySelector('.cm-editor')
  if (!dom) throw new Error('CodeMirror editor not found')
  const view = EditorView.findFromDOM(dom as HTMLElement)
  if (!view) throw new Error('EditorView.findFromDOM returned null')
  return view
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('code-block edit persistence', () => {
  it('hydrates stored edits for the matching turnId + node.id scope', async () => {
    window.localStorage.setItem(key('turn-A', 'node-1'), 'stored edit')

    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'node-1', type: 'codeBlock', code: 'original', language: 'json' }])}
        plugins={[codePlugin]}
        renderOptions={{ codeBlockPersistenceScopeId: 'turn-A' }}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const view = findEditorView(container)
    expect(view.state.doc.toString()).toBe('stored edit')
  })

  it('persists edits to localStorage after the debounce window', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'node-2', type: 'codeBlock', code: 'before', language: 'json' }])}
        plugins={[codePlugin]}
        renderOptions={{ codeBlockPersistenceScopeId: 'turn-B' }}
      />
    )
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const view = findEditorView(container)
    view.dispatch({ changes: { from: 6, insert: '!' } })

    await waitFor(
      () => expect(window.localStorage.getItem(key('turn-B', 'node-2'))).toBe('before!'),
      { timeout: 1000 }
    )
  })

  it('deletes the stored key when the value reverts to the source code', async () => {
    window.localStorage.setItem(key('turn-C', 'node-3'), 'stale edit')

    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'node-3', type: 'codeBlock', code: 'original', language: 'json' }])}
        plugins={[codePlugin]}
        renderOptions={{ codeBlockPersistenceScopeId: 'turn-C' }}
      />
    )
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const view = findEditorView(container)
    const current = view.state.doc.toString()
    view.dispatch({
      changes: { from: 0, to: current.length, insert: 'original' }
    })

    await waitFor(
      () => expect(window.localStorage.getItem(key('turn-C', 'node-3'))).toBeNull(),
      { timeout: 1000 }
    )
  })

  it('does not hydrate or write while isStreaming is true', async () => {
    window.localStorage.setItem(key('turn-D', 'node-4'), 'stored-but-streaming')

    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'node-4', type: 'codeBlock', code: 'live source', language: 'json' }])}
        plugins={[codePlugin]}
        renderOptions={{ codeBlockPersistenceScopeId: 'turn-D' }}
        isStreaming
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const view = findEditorView(container)
    expect(view.state.doc.toString()).toBe('live source')

    act(() => {
      view.dispatch({ changes: { from: 11, insert: '!' } })
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(window.localStorage.getItem(key('turn-D', 'node-4'))).toBe('stored-but-streaming')
  })

  it('does nothing without a codeBlockPersistenceScopeId', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'node-5', type: 'codeBlock', code: 'ephemeral', language: 'json' }])}
        plugins={[codePlugin]}
      />
    )
    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const view = findEditorView(container)
    view.dispatch({ changes: { from: 9, insert: '!' } })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(window.localStorage.length).toBe(0)
  })
})
