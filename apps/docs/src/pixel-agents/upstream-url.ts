import useBaseUrl from '@docusaurus/useBaseUrl'

// Builds an ABSOLUTE resolver for PixelAgentsStage's `resolveUpstreamUrl`
// contract (issue #452). The prepared Pixel Agents bundle is served at
// `${siteBaseUrl}upstream/**` (see docusaurus.config.ts's
// `pixelAgentsUpstreamDir` static directory) — `useBaseUrl` already accounts
// for both the `/docs/` route prefix and any deploy-base prefix
// (`TINYTINKERER_DEPLOY_BASE` preview builds), so the resolved URL is correct
// no matter how deeply nested the CURRENT page's own route is. The stage's
// own default resolver (relative to `document.baseURI`) only works for a host
// mounted at one fixed app route, which a Docusaurus doc page is not.
export const useResolveUpstreamUrl = (): ((path: string) => string) => {
  const upstreamBase = useBaseUrl('upstream/')
  return (path: string): string => new URL(`${upstreamBase}${path}`, window.location.origin).href
}
