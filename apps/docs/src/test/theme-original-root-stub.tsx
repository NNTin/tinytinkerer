import type { ReactNode } from 'react'

// Test-only stand-in for Docusaurus's `@theme-original/Root` — a pure
// webpack-alias specifier (see the MDXComponents stub for why a plain Vite
// resolver needs an alias target at all). It mirrors core's own theme fallback
// Root (client/theme-fallback/Root/index.tsx), which is a pass-through wrapper,
// but tags its output so a test can prove src/theme/Root.tsx really renders
// *through* the original theme Root rather than replacing it.
export default function Root({ children }: { children: ReactNode }) {
  return <div data-testid="theme-original-root">{children}</div>
}
