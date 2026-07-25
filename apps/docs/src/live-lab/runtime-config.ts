import { useMemo } from 'react'
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
  const {
    tinyEdgeBaseUrl,
    tinyGithubClientId,
    tinySentryDsn,
    tinySentryEnvironment,
    tinyProductBaseUrl
  } = customFields

  // Memoized by the underlying primitive values (stable for the lifetime of the
  // page — this is static site config baked in at build time), NOT a fresh object
  // literal every render: ClientRuntime's bootstrap effect (client-runtime.tsx)
  // depends on this value by reference, and an unstable reference there re-fires
  // the effect on every render it causes, which re-sets state, which re-renders —
  // an infinite loop that pegs the tab's CPU on any page with a <LiveLab>.
  return useMemo<DocsLabRuntimeConfig>(
    () => ({
      edgeBaseUrl: tinyEdgeBaseUrl,
      githubClientId: tinyGithubClientId,
      sentryDsn: tinySentryDsn,
      sentryEnvironment: tinySentryEnvironment,
      productBaseUrl: tinyProductBaseUrl
    }),
    [tinyEdgeBaseUrl, tinyGithubClientId, tinySentryDsn, tinySentryEnvironment, tinyProductBaseUrl]
  )
}
