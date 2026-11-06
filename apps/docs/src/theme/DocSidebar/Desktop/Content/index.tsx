import type { ComponentProps, ReactNode } from 'react'
import OriginalContent from '@theme-original/DocSidebar/Desktop/Content'
import { DocsAssistantOfficeSidebarSlot, useDocsAssistantEnabled } from '@site/src/docs-runtime'

// Where the Pixel Agents Office is put into the documentation sidebar (issue
// #472). A wrapper, so the theme's own navigation keeps working untouched.
//
// **Why this component and not `DocSidebar/Desktop`.** theme-classic's
// `Desktop` is a flex column with `height: 100%` whose `Content` is the
// `flex-grow: 1` child; a sibling rendered after it therefore lands at the
// bottom of the column at its own natural height, above the collapse button,
// without anything having to restyle a hashed CSS-module class. Wrapping
// `Desktop` instead would mean either ejecting its stylesheet or fighting it.
//
// It is also desktop-only by construction, which is the behaviour we want: the
// mobile drawer renders `DocSidebarItems` directly and never reaches this file,
// and a pixel-art room is not what a phone reader needs from a navigation menu.
//
// LIGHT by obligation. Every documentation page loads the sidebar, so an import
// of `@tinytinkerer/app-browser` or `@tinytinkerer/pixel-agents` from anywhere
// on this path would put the product runtime in every page's initial HTML.
// `@site/src/docs-runtime` is the light barrel; the Office itself arrives by
// portal, out of the lazily-loaded assistant chunk.

// `@theme-original/*` is a Docusaurus webpack alias with no real type
// declarations, so it resolves to `any`; this annotation is what keeps the
// wrapper typed, the same technique `theme/Root.tsx` uses.
type ContentProps = ComponentProps<'nav'> & { path: string; sidebar: unknown[] }
const ThemeContent = OriginalContent as (props: ContentProps) => ReactNode

export default function DocSidebarDesktopContent(props: ContentProps): ReactNode {
  // Issue #481's rollback switch. `@theme/Root` honours it for the assistant as
  // a whole; honour it here too, or a rolled-back deployment would still show a
  // sidebar control for a runtime that can never start.
  const assistantEnabled = useDocsAssistantEnabled()

  return (
    <>
      <ThemeContent {...props} />
      {assistantEnabled ? <DocsAssistantOfficeSidebarSlot /> : null}
    </>
  )
}
