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

// Config the docs site needs at RUNTIME, in the browser, but which is only known
// at Docusaurus's Node-side build time (env vars, deploy base). Docusaurus has no
// other channel from build-time Node config to client-side React than
// `siteConfig.customFields` (serialized into the page, read back via
// useDocusaurusContext) — there is no request-time server to expose a config
// endpoint from, since the whole site is static.
//
// Named for the LiveLab framework it was introduced for (issue #451), and
// renamed here (issue #481): every field is shared by BOTH docs `BrowserApp`s —
// the live labs and the global assistant — and the rollback flag below is about
// the assistant specifically, so a `…LabCustomFields` name had stopped
// describing its contents.
export type DocsRuntimeCustomFields = {
  tinyEdgeBaseUrl: string
  tinyGithubClientId: string | undefined
  tinySentryDsn: string | undefined
  tinySentryEnvironment: string | undefined
  // Where the product itself is served, e.g. `/` or `/pr-42/` for a preview
  // deploy — needed to compute the GitHub OAuth redirect_uri the product's own
  // callback route owns (see live-lab/sign-in.ts).
  tinyProductBaseUrl: string
  // The #481 rollback switch. See resolveDocsAssistantEnabled below.
  tinyDocsAssistantEnabled: boolean
}

/**
 * The documentation assistant's emergency rollback switch (issue #481).
 *
 * A **build-time** flag, deliberately: disabling the assistant requires a
 * rebuild and redeploy, which is what an emergency rollback of a shipped
 * feature already needs. The alternatives were rejected —
 *
 * - a runtime/`localStorage` switch cannot help the case that motivates a
 *   rollback (every reader is affected, and no reader will set a flag);
 *   `@theme/Root` would also still have to mount the assistant tree to read it,
 *   so the thing being rolled back would run anyway;
 * - hiding only the widget while still booting the runtime rolls back the
 *   symptom rather than the cause, and leaves the corpus request, the page-inset
 *   wrapper and the document-global ownership in place.
 *
 * Default ON: the assistant ships enabled, and it takes an explicit
 * `TINYTINKERER_DOCS_ASSISTANT=off` to remove it. Any value other than the
 * documented off-switches leaves it on, so a typo cannot silently disable the
 * feature on a production deploy.
 *
 * With it off, `/docs/` renders ordinary Docusaurus pages: no assistant
 * provider, no launcher, no page-inset wrapper, and no corpus-manifest request.
 * Live labs are untouched — they boot from `live-lab/client-runtime.tsx`, which
 * this flag does not reach. The consequence is that nothing on `/docs/` then
 * owns the telemetry-consent or privacy-update hosts; that is acceptable for an
 * emergency rollback precisely because telemetry defaults to off, so "no consent
 * host" means "no telemetry", not "undisclosed collection".
 */
export const resolveDocsAssistantEnabled = (value: string | undefined): boolean => {
  const normalized = (value ?? '').trim().toLowerCase()
  return !(normalized === 'off' || normalized === 'false' || normalized === '0')
}

export const resolveDocsRuntimeCustomFields = (
  deployBase: string | undefined,
  env: {
    edgeBaseUrl?: string
    githubClientId?: string
    sentryDsn?: string
    sentryEnvironment?: string
    docsAssistant?: string
  }
): DocsRuntimeCustomFields => ({
  tinyEdgeBaseUrl: env.edgeBaseUrl ?? '',
  tinyGithubClientId: env.githubClientId,
  tinySentryDsn: env.sentryDsn,
  tinySentryEnvironment: env.sentryEnvironment,
  tinyProductBaseUrl: resolveProductBaseUrl(deployBase),
  tinyDocsAssistantEnabled: resolveDocsAssistantEnabled(env.docsAssistant)
})
