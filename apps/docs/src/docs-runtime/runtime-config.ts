import { useMemo } from 'react'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import type { DocsRuntimeCustomFields } from '../../site-config'

export type DocsRuntimeConfig = {
  edgeBaseUrl: string
  githubClientId: string | undefined
  sentryDsn: string | undefined
  sentryEnvironment: string | undefined
  productBaseUrl: string
}

const FALLBACK_CUSTOM_FIELDS: DocsRuntimeCustomFields = {
  tinyEdgeBaseUrl: '',
  tinyGithubClientId: undefined,
  tinySentryDsn: undefined,
  tinySentryEnvironment: undefined,
  tinyProductBaseUrl: '/',
  // Enabled, matching `resolveDocsAssistantEnabled`'s own default: a page served
  // without custom fields at all is a misconfiguration, and the rollback switch
  // must only ever be armed by someone deliberately arming it.
  tinyDocsAssistantEnabled: true
}

const readCustomFields = (
  customFields: Record<string, unknown> | undefined
): DocsRuntimeCustomFields => ({
  ...FALLBACK_CUSTOM_FIELDS,
  ...(customFields as Partial<DocsRuntimeCustomFields> | undefined)
})

/**
 * Whether the documentation assistant is built into this deployment at all
 * (issue #481's rollback switch).
 *
 * Read here rather than in `@theme/Root` directly so the one place that decides
 * is also the one place that knows the fallback. `Root` consults it before
 * mounting ANY part of the assistant integration — provider, page region, and
 * host — so a rolled-back deployment issues no corpus request and renders no
 * launcher.
 */
export const useDocsAssistantEnabled = (): boolean => {
  const { siteConfig } = useDocusaurusContext()
  return readCustomFields(siteConfig.customFields).tinyDocsAssistantEnabled
}

// Reads the config docusaurus.config.ts baked into every page via `customFields`
// (see site-config.ts's resolveDocsRuntimeCustomFields) — the same
// edge/GitHub-OAuth configuration the product's own Vite builds resolve from
// VITE_* env vars, just carried across the Node build → static-page boundary
// Docusaurus provides.
//
// Shared by every docs BrowserApp (issue #479): the live labs and the global
// documentation assistant read the identical build-time configuration and differ
// only in storage namespace, tools, and document-global ownership.
export const useDocsRuntimeConfig = (): DocsRuntimeConfig => {
  const { siteConfig } = useDocusaurusContext()
  const customFields = readCustomFields(siteConfig.customFields)
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
