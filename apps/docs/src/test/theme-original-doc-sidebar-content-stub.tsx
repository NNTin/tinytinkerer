import type { ReactNode } from 'react'

// Test-only stand-in for Docusaurus's `@theme-original/DocSidebar/Desktop/Content`
// — a pure webpack-alias specifier (see the MDXComponents stub for why a plain
// Vite resolver needs an alias target at all).
//
// It mirrors the shape theme-classic's own Content renders: a `Docs sidebar`
// navigation landmark, the `flex-grow: 1` element the Office slot is placed
// after. Tagged so a test can prove the swizzle renders *through* the theme's
// own sidebar rather than replacing it.
export default function DocSidebarDesktopContent(props: {
  path: string
  sidebar: unknown[]
}): ReactNode {
  return (
    <nav aria-label="Docs sidebar" data-testid="theme-original-doc-sidebar-content">
      {props.path}
    </nav>
  )
}
