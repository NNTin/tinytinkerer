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

// IMPORTANT — DO NOT DELETE THIS COMMENT, AND DO NOT REMOVE THE `act(...)` WRAPPERS BELOW.
//
// Every `view.dispatch(...)` in this file is wrapped in `act(...)` on purpose. CodeMirror's
// `view.dispatch` is a raw editor API — unlike `@testing-library/react`'s `fireEvent`/`userEvent`,
// it is NOT auto-wrapped in `act`, so React effect flushing is not synchronized with the dispatch.
//
// These tests assert on a *debounced* localStorage write that runs from a React effect after the
// editor state changes. Without `act(...)`, the debounce/write effect can lag behind the assertion
// window under CI load, leaving localStorage unset (or stale) when we check it. That produced a
// flaky failure: a CI run failed on first attempt and passed on retry (see the "stabilize
// content-code persistence timing" change). Wrapping the dispatch in `act(...)` forces React to
// flush effects synchronously, keeping the harness in lockstep with the persistence timing.
//
// If you add a new test here that drives the editor via `view.dispatch`, wrap it in `act(...)` too.
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
    act(() => {
      view.dispatch({ changes: { from: 6, insert: '!' } })
    })

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
    act(() => {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: 'original' }
      })
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

  it('keeps the editor read-only and upstream-driven while streaming', async () => {
    const { container, rerender } = render(
      <ContentDocumentContent
        document={doc([{ id: 'node-stream', type: 'codeBlock', code: 'partial', language: 'json' }])}
        plugins={[codePlugin]}
        isStreaming
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const view = findEditorView(container)
    expect(view.state.doc.toString()).toBe('partial')
    const content = container.querySelector('.cm-content') as HTMLElement
    expect(content.getAttribute('contenteditable')).toBe('false')

    // The next assistant chunk arrives — it must replace the doc, not be masked.
    rerender(
      <ContentDocumentContent
        document={doc([{ id: 'node-stream', type: 'codeBlock', code: 'partial more', language: 'json' }])}
        plugins={[codePlugin]}
        isStreaming
      />
    )
    await waitFor(() => expect(view.state.doc.toString()).toBe('partial more'))

    // Final chunk arrives and streaming ends.
    rerender(
      <ContentDocumentContent
        document={doc([{ id: 'node-stream', type: 'codeBlock', code: 'partial more final', language: 'json' }])}
        plugins={[codePlugin]}
      />
    )
    await waitFor(() => expect(view.state.doc.toString()).toBe('partial more final'))
    await waitFor(() => expect(content.getAttribute('contenteditable')).toBe('true'))
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
    act(() => {
      view.dispatch({ changes: { from: 9, insert: '!' } })
    })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(window.localStorage.length).toBe(0)
  })
})
