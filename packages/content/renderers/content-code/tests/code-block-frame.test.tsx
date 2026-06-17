// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContentDocumentContent, type ContentDocument } from '@tinytinkerer/content-react'
import { EditorView } from '@codemirror/view'
import { codePlugin } from '../src/index'

afterEach(() => {
  cleanup()
})

const doc = (nodes: ContentDocument['nodes']): ContentDocument => ({ nodes })

const findEditorView = (container: HTMLElement): EditorView => {
  const dom = container.querySelector('.cm-editor')
  if (!dom) throw new Error('CodeMirror editor not found')
  const view = EditorView.findFromDOM(dom as HTMLElement)
  if (!view) throw new Error('EditorView.findFromDOM returned null')
  return view
}

// IMPORTANT — DO NOT DELETE THIS COMMENT, AND DO NOT REMOVE THE `act(...)` WRAPPERS BELOW.
// `view.dispatch(...)` is a raw CodeMirror API and is NOT auto-wrapped in `act` the way
// `@testing-library/react` events are. These tests assert on React-effect-driven state that follows
// the dispatch, so the dispatch must run inside `act(...)` to keep effect flushing synchronized and
// avoid flaky timing failures. See tests/persistence.test.tsx for the full explanation.
describe('code-block frame rendering', () => {
  it('renders a CodeMirror surface for an unlanguaged fenced block with "Code" label', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'n1', type: 'codeBlock', code: 'just plain text' }])}
        plugins={[codePlugin]}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(screen.getByText('Code')).toBeInTheDocument()
  })

  it('renders a CodeMirror surface for a typescript block with a TYPESCRIPT label', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([
          { id: 'n2', type: 'codeBlock', code: 'const x: number = 1', language: 'typescript' }
        ])}
        plugins={[codePlugin]}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(screen.getByText('TYPESCRIPT')).toBeInTheDocument()
  })

  it('updates the copyable value when the user types into the editor', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'n3', type: 'codeBlock', code: 'hello', language: 'json' }])}
        plugins={[codePlugin]}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const view = findEditorView(container)
    act(() => {
      view.dispatch({ changes: { from: 5, insert: '!' } })
    })

    let capturedText = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          capturedText = text
          return Promise.resolve()
        }
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(capturedText).toBe('hello!'))
  })
})

describe('fullscreen behavior', () => {
  it('opens and closes the fullscreen dialog via button and Escape', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'n4', type: 'codeBlock', code: 'open me', language: 'json' }])}
        plugins={[codePlugin]}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('hides the fullscreen button when render options disable it', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'n5', type: 'codeBlock', code: 'no fs', language: 'json' }])}
        plugins={[codePlugin]}
        renderOptions={{ showCodeBlockFullscreenButton: false }}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
  })

  it('shows the Edited locally indicator with tooltip and resets via the Reset button', async () => {
    const sourceNode = { id: 'n7', type: 'codeBlock' as const, code: 'src', language: 'json' }
    const { container } = render(
      <ContentDocumentContent document={doc([sourceNode])} plugins={[codePlugin]} />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    expect(screen.queryByText('Edited locally')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset to original' })).toBeNull()

    const view = findEditorView(container)
    act(() => {
      view.dispatch({ changes: { from: 3, insert: '!' } })
    })

    const indicator = await screen.findByText('Edited locally')
    expect(indicator).toHaveAttribute(
      'title',
      'These changes are local only. They do not affect chat history, and the agent is unaware of them.'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reset to original' }))
    await waitFor(() => expect(view.state.doc.toString()).toBe('src'))
    expect(screen.queryByText('Edited locally')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset to original' })).toBeNull()

    // Sanity check: source node was not mutated.
    expect(sourceNode.code).toBe('src')
  })

  it('preserves the latest edited text from inline to fullscreen', async () => {
    const { container } = render(
      <ContentDocumentContent
        document={doc([{ id: 'n6', type: 'codeBlock', code: 'seed', language: 'json' }])}
        plugins={[codePlugin]}
      />
    )

    await waitFor(() => expect(container.querySelector('.cm-editor')).not.toBeNull())
    const inlineView = findEditorView(container)
    act(() => {
      inlineView.dispatch({ changes: { from: 4, insert: ' edited' } })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(dialog.querySelector('.cm-editor')).not.toBeNull())
    const modalEditor = dialog.querySelector('.cm-editor') as HTMLElement
    const modalView = EditorView.findFromDOM(modalEditor)
    expect(modalView?.state.doc.toString()).toBe('seed edited')
  })
})
