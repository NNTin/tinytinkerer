import type { ReactNode } from 'react'

// Test-only stand-in for Docusaurus's `@theme`-aliased `@docusaurus/BrowserOnly`
// (see the MDXComponents stub for why a plain Vite resolver needs an alias
// target at all). Mirrors the real component's contract closely enough for
// tests that don't override it via vi.mock: render `fallback` when there is no
// `window` (a static build), otherwise invoke the children render-prop.
export default function BrowserOnly({
  children,
  fallback
}: {
  children: () => ReactNode
  fallback?: ReactNode
}) {
  return typeof window === 'undefined' ? (fallback ?? null) : children()
}
