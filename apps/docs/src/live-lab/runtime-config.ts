import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import type { DocsLabCustomFields } from '../../site-config'

export type DocsLabRuntimeConfig = {
  edgeBaseUrl: string
  githubClientId: string | undefined
  sentryDsn: string | undefined
  sentryEnvironment: string | undefined
  productBaseUrl: string
}

const FALLBACK_CUSTOM_FIELDS: DocsLabCustomFields = {
  tinyEdgeBaseUrl: '',
  tinyGithubClientId: undefined,
  tinySentryDsn: undefined,
  tinySentryEnvironment: undefined,
  tinyProductBaseUrl: '/'
}

// Reads the config docusaurus.config.ts baked into every page via `customFields`
// (see site-config.ts's resolveDocsLabCustomFields) — the same edge/GitHub-OAuth
// configuration the product's own Vite builds resolve from VITE_* env vars, just
// carried across the Node build → static-page boundary Docusaurus provides.
export const useDocsLabRuntimeConfig = (): DocsLabRuntimeConfig => {
  const { siteConfig } = useDocusaurusContext()
  const customFields = {
    ...FALLBACK_CUSTOM_FIELDS,
    ...(siteConfig.customFields as Partial<DocsLabCustomFields> | undefined)
  }

  return {
    edgeBaseUrl: customFields.tinyEdgeBaseUrl,
    githubClientId: customFields.tinyGithubClientId,
    sentryDsn: customFields.tinySentryDsn,
    sentryEnvironment: customFields.tinySentryEnvironment,
    productBaseUrl: customFields.tinyProductBaseUrl
  }
}
