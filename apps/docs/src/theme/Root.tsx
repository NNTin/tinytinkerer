import type { ReactNode } from 'react'
import OriginalRoot from '@theme-original/Root'
import { DocsPageProvider } from '../docs-page'

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

export default function Root({ children }: { children: ReactNode }): ReactNode {
  return (
    <ThemeRoot>
      <DocsPageProvider>{children}</DocsPageProvider>
    </ThemeRoot>
  )
}
