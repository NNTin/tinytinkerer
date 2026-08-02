import type { ReactNode } from 'react'
import OriginalRoot from '@theme-original/Root'
import { DocsPageProvider } from '../docs-page'
import {
  DocsAssistantPageRegion,
  DocsAssistantRuntimeHost,
  useDocsAssistantEnabled
} from '../docs-runtime'

// Docusaurus keeps `@theme/Root` mounted for the whole lifetime of the SPA:
// above the layout, outside the route tree, and inside both the router and the
// Docusaurus context (see @docusaurus/core's client/App.tsx). It is therefore
// the one place a provider can observe every client-side navigation without
// being torn down by one — which is exactly what the documentation assistant's
// "what document am I on?" bridge needs (issue #476).
//
// This wraps rather than replaces the theme's own Root, so anything the active
// theme puts there keeps working.

// `@theme-original/Root` is a Docusaurus webpack alias with no real type
// declarations, so it resolves to `any`; the annotation below is what keeps
// this component typed.
const ThemeRoot = OriginalRoot as (props: { children: ReactNode }) => ReactNode

// The assistant runtime host is a SIBLING of `children`, never an ancestor
// (issue #479): `BrowserAppShell` renders a boot screen in place of its children
// and wraps them in StrictMode and an error boundary, so hosting the
// documentation inside it would blank the page while the assistant booted and
// remount every live lab the first time a reader opened it. As a sibling it
// persists across SPA navigation just the same — this whole tree does — while
// the page tree above stays untouched.
//
// It renders nothing until something calls `requestDocsAssistantRuntime()`, and
// it stays inside `DocsPageProvider` so the assistant's tools resolve the same
// active document the page context reports.
export default function Root({ children }: { children: ReactNode }): ReactNode {
  // Issue #481's rollback switch, and the ONE place it is honoured — the whole
  // assistant integration hangs off this subtree, so removing it here removes
  // the provider, the corpus-manifest request, the page-inset wrapper, and the
  // launcher in one step. `children` is rendered exactly as the theme's own Root
  // would, so a rolled-back deployment is an ordinary Docusaurus site.
  //
  // Live labs are deliberately NOT reached by this: they boot from
  // `live-lab/client-runtime.tsx` on the pages that embed them, and an assistant
  // rollback must not take the documentation's interactive examples with it.
  //
  // Reading the flag is a hook, so it must run before any early return.
  const assistantEnabled = useDocsAssistantEnabled()

  if (!assistantEnabled) {
    return <ThemeRoot>{children}</ThemeRoot>
  }

  return (
    <ThemeRoot>
      <DocsPageProvider>
        {/* A stable region, present in every mode from the first render, so
            docking the assistant insets the page instead of covering it — and
            does so without remounting anything inside, which would restart every
            live lab on the route mid-session (issue #480 re-review, finding 2). */}
        <DocsAssistantPageRegion>{children}</DocsAssistantPageRegion>
        <DocsAssistantRuntimeHost />
      </DocsPageProvider>
    </ThemeRoot>
  )
}
