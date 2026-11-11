import { lazy, Suspense, type ReactNode } from 'react'
import type { ReadOnlyCodeViewProps } from '@tinytinkerer/content-code'

// content-code is CodeMirror plus every Lezer grammar it highlights — over a
// megabyte unminified. The panels that show a tool's code (turn activity, the
// permission modal, the context inspector) used to import its ReadOnlyCodeView
// statically, which put all of that on the chat surface's eager path: an
// embedding host paid for it on first open even while signed out, just to show
// a sign-in button (issue #518, F12). Behind this wrapper it is fetched the
// first time a code section actually renders.
const ReadOnlyCodeView = lazy(() =>
  import('@tinytinkerer/content-code').then((module) => ({ default: module.ReadOnlyCodeView }))
)

// Until it arrives, the same text in the same box, so the section neither
// collapses nor jumps when the editor replaces it.
export const LazyReadOnlyCodeView = (props: ReadOnlyCodeViewProps): ReactNode => (
  <Suspense
    fallback={<pre className={`${props.className ?? 'tt-code-editor'} text-xs`}>{props.value}</pre>}
  >
    <ReadOnlyCodeView {...props} />
  </Suspense>
)
