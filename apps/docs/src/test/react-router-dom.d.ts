// Test-only. This workspace deliberately does not depend on react-router-dom:
// it reaches the router exclusively through Docusaurus, whose own webpack alias
// `@docusaurus/router` re-exports the copy Docusaurus pins. Tests need the two
// router *containers* that alias does not re-export (`MemoryRouter`,
// `StaticRouter`) plus `useHistory` to drive a navigation, and
// apps/docs/vitest.config.ts resolves this specifier to the very same physical
// copy Docusaurus uses, so a test's router and the docs plugin's `useLocation`
// land in one context.
//
// Declaring the small surface used here — rather than adding a second pinned
// dependency whose version could drift from Docusaurus' — follows the same
// pattern as docs-corpus/github-slugger.d.ts and
// docs-search/easyops-search-worker.d.ts.
//
// The specifier is deliberately NOT the bare package name: other workspace
// packages in this TypeScript program (packages/app/app-browser) depend on a
// real, much newer react-router-dom, and an ambient `declare module
// 'react-router-dom'` would silently replace their types with this three-export
// sliver.
declare module '@docs-test/react-router-dom' {
  import type { ReactNode } from 'react'

  export function MemoryRouter(props: {
    children?: ReactNode
    initialEntries?: string[]
  }): ReactNode

  export function StaticRouter(props: { children?: ReactNode; location?: string }): ReactNode

  export function useHistory(): { push: (path: string) => void }
}
