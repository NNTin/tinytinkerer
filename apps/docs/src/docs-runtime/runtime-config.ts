import { useMemo } from 'react'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import type { DocsLabCustomFields } from '../../site-config'

export type DocsRuntimeConfig = {
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
//
// Shared by every docs BrowserApp (issue #479): the live labs and the global
// documentation assistant read the identical build-time configuration and differ
// only in storage namespace, tools, and document-global ownership. The
// `DocsLabCustomFields` name predates the assistant; the fields are the docs
// site's, not the labs'.
export const useDocsRuntimeConfig = (): DocsRuntimeConfig => {
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
  return useMemo<DocsRuntimeConfig>(
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
