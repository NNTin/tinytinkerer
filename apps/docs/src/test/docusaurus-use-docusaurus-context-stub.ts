// Test-only stand-in for the `@docusaurus/useDocusaurusContext` alias — see the
// MDXComponents stub for why a plain Vite resolver needs an alias target at all.
export default function useDocusaurusContext() {
  return { siteConfig: { customFields: {} } }
}
