// Test-only stand-in for the `@docusaurus/useDocusaurusContext` alias — see the
// MDXComponents stub for why a plain Vite resolver needs an alias target at all.
//
// The defaults mirror this site's real docusaurus.config.ts (`baseUrl` from
// site-config.ts's `resolveDocsBaseUrl`, `trailingSlash: true`), so a test that
// does not care about URL policy still exercises the production one. Tests that
// do care set it explicitly; tests needing something this shape does not cover
// keep overriding the whole module with `vi.mock`.
type StubSiteConfig = {
  baseUrl: string
  trailingSlash: boolean | undefined
  customFields: Record<string, unknown>
}

const DEFAULT_SITE_CONFIG: StubSiteConfig = {
  baseUrl: '/docs/',
  trailingSlash: true,
  customFields: {}
}

let siteConfig: StubSiteConfig = { ...DEFAULT_SITE_CONFIG }

export const __setSiteConfig = (overrides: Partial<StubSiteConfig>): void => {
  siteConfig = { ...siteConfig, ...overrides }
}

export const __resetSiteConfig = (): void => {
  siteConfig = { ...DEFAULT_SITE_CONFIG }
}

export default function useDocusaurusContext() {
  return { siteConfig }
}
