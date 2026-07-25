// Test-only stand-in for the `@docusaurus/useBaseUrl` alias — see the
// MDXComponents stub for why a plain Vite resolver needs an alias target at
// all. Mirrors the real hook's contract closely enough for tests: prefixes
// `path` with a fixed, deploy-base-like prefix rather than resolving anything
// from a real Docusaurus site config.
export default function useBaseUrl(path: string): string {
  return `/docs/${path}`
}
