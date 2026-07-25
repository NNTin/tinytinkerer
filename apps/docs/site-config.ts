const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '')

export const resolveDeployBase = (value: string | undefined): string => trimSlashes(value ?? '')

export const resolveDocsBaseUrl = (value: string | undefined): string => {
  const deployBase = resolveDeployBase(value)
  return `/${deployBase ? `${deployBase}/` : ''}docs/`
}

export const resolveProductBaseUrl = (value: string | undefined): string => {
  const deployBase = resolveDeployBase(value)
  return deployBase ? `/${deployBase}/` : '/'
}

// webpack-dev-server's default HMR endpoint. The unified host proxies this
// upgrade alongside `/docs/*` during local development.
export const DOCS_DEV_WEBSOCKET_PATH = '/ws'

// Config the LiveLab framework (issue #451) needs at RUNTIME, in the browser, but
// which is only known at Docusaurus's Node-side build time (env vars, deploy base).
// Docusaurus has no other channel from build-time Node config to client-side React
// than `siteConfig.customFields` (serialized into the page, read back via
// useDocusaurusContext) — there is no request-time server to expose a config
// endpoint from, since the whole site is static.
export type DocsLabCustomFields = {
  tinyEdgeBaseUrl: string
  tinyGithubClientId: string | undefined
  tinySentryDsn: string | undefined
  tinySentryEnvironment: string | undefined
  // Where the product itself is served, e.g. `/` or `/pr-42/` for a preview
  // deploy — needed to compute the GitHub OAuth redirect_uri the product's own
  // callback route owns (see live-lab/sign-in.ts).
  tinyProductBaseUrl: string
}

export const resolveDocsLabCustomFields = (
  deployBase: string | undefined,
  env: {
    edgeBaseUrl?: string
    githubClientId?: string
    sentryDsn?: string
    sentryEnvironment?: string
  }
): DocsLabCustomFields => ({
  tinyEdgeBaseUrl: env.edgeBaseUrl ?? '',
  tinyGithubClientId: env.githubClientId,
  tinySentryDsn: env.sentryDsn,
  tinySentryEnvironment: env.sentryEnvironment,
  tinyProductBaseUrl: resolveProductBaseUrl(deployBase)
})
