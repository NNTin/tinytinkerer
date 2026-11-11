import { describe, expect, it } from 'vitest'
import { ChatApp, type ChatAppProps } from '../src/chat-shell/chat-app'

// Type-level: these elements are built, never rendered. `tsc` (typecheck) is
// the real assertion; the test only keeps vitest from calling the file empty.
const Loading = () => null

describe('ChatApp props (issue #518, F10)', () => {
  it('accepts both arms of ChatAppProps, and a spread of the union', () => {
    const elements = [
      <ChatApp key="u" storageKey="k" LoadingComponent={Loading} mode="sidebar" />,
      <ChatApp
        key="c"
        storageKey="k"
        LoadingComponent={Loading}
        presentation={{ mode: 'sidebar', minimized: false, edge: 'right' }}
        onPresentationChange={() => {}}
      />,
      ((props: ChatAppProps) => <ChatApp key="s" {...props} />)({
        storageKey: 'k',
        LoadingComponent: Loading
      })
    ]
    expect(elements).toHaveLength(3)
  })

  it('rejects a controlled ChatApp without onPresentationChange', () => {
    // The error is "Property 'onPresentationChange' is missing", not the old
    // "Type 'string' is not assignable to type 'ChatMode'".
    const element = (
      // @ts-expect-error -- a controlled ChatApp needs onPresentationChange
      <ChatApp
        storageKey="k"
        LoadingComponent={Loading}
        presentation={{ mode: 'sidebar', minimized: false, edge: 'right' }}
      />
    )
    expect(element).toBeTruthy()
  })
})
