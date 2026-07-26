/**
 * Maps a documentation-search hit's page URL back to a #474 corpus ref.
 *
 * This module knows nothing about the private search plugin — it only reads
 * the #474 documentation corpus's own public locator/manifest (see
 * apps/docs/src/docs-corpus/plugin.ts and build-corpus.ts). The locator is
 * discovered via `@generated/globalData`, Docusaurus' own stable, public
 * plugin-data channel (the same data `useGlobalData`/`usePluginData` read) —
 * not a virtual module owned by the easyops plugin.
 */
import type { DocumentationCorpusSchemaVersion } from '@tinytinkerer/app-browser'
import globalData from '@generated/globalData'
import { canonicalizeDocusaurusPermalink } from '../docs-corpus/docusaurus-compatibility'

const CORPUS_PLUGIN_NAME = 'documentation-corpus'
const CORPUS_PLUGIN_ID = 'default'
// Mirrors @tinytinkerer/contracts' DOCUMENTATION_CORPUS_SCHEMA_VERSION. Kept
// as a local literal — not a value import — because @tinytinkerer/app-browser's
// barrel has real runtime side effects at import time (e.g. PWA
// service-worker registration via a `virtual:pwa-register` module this
// package's own build provides but a plain vitest run does not), which a
// type-only concern like this shouldn't pull in. The type annotation still
// makes this fail to compile if the shared contract's schema version ever
// changes without this literal being updated too.
const CORPUS_SCHEMA_VERSION: DocumentationCorpusSchemaVersion = 1

type CorpusLocator = { schemaVersion: number; manifestHash: string; manifestUrl: string }

/**
 * Only the manifest-entry fields this module actually reads and validates.
 * Deliberately narrower than (and not cast to) the full
 * `DocumentationCorpusManifestEntry` contract type: that type carries fields
 * (`source`, `contentHash`, `artifactHash`, `artifact`, `characterCount`,
 * `sectionCount`) this module never uses and never validates, so pretending
 * to produce the full type would be dishonest. `search-documentation.ts`
 * consumes exactly this shape.
 */
export type CorpusRefMapEntry = {
  ref: string
  version: string
  versionPath: string
  isLast: boolean
  title: string
  permalink: string
  unlisted: boolean
}

type CorpusManifestForSearch = {
  schemaVersion: number
  manifestHash: string
  documents: CorpusRefMapEntry[]
}

export type SiteUrlConfig = { baseUrl: string; trailingSlash: boolean | undefined }

// Extracts the pathname before canonicalizing, so an absolute URL (a
// different origin/scheme than the one a raw search hit happens to carry)
// and a bare path both normalize identically; `URL.pathname` already
// excludes any query string/fragment. The base passed to `URL` is only ever
// used to resolve a relative path — it never appears in the result.
const toPathname = (value: string): string => {
  try {
    return new URL(value, 'http://localhost').pathname
  } catch {
    return value
  }
}

// Reuses the exact canonicalization the #474 corpus manifest itself was
// built with (docs-corpus/docusaurus-compatibility.ts), so a hit's raw page
// URL and a manifest permalink can never drift apart over base-url,
// versioned-path, or trailing-slash differences between the two producers.
const normalizePermalink = (value: string, siteConfig: SiteUrlConfig): string =>
  canonicalizeDocusaurusPermalink(toPathname(value), siteConfig)

const isLocator = (value: unknown): value is CorpusLocator =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).manifestUrl === 'string' &&
  typeof (value as Record<string, unknown>).schemaVersion === 'number' &&
  typeof (value as Record<string, unknown>).manifestHash === 'string'

const readLocator = (): CorpusLocator | undefined => {
  const pluginData = (globalData as unknown as Record<string, Record<string, unknown> | undefined>)[
    CORPUS_PLUGIN_NAME
  ]
  const locator = pluginData?.[CORPUS_PLUGIN_ID]
  return isLocator(locator) ? locator : undefined
}

const isManifestEntry = (value: unknown): value is CorpusRefMapEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.ref === 'string' &&
    typeof entry.version === 'string' &&
    typeof entry.versionPath === 'string' &&
    typeof entry.isLast === 'boolean' &&
    typeof entry.title === 'string' &&
    typeof entry.permalink === 'string' &&
    typeof entry.unlisted === 'boolean'
  )
}

const isManifest = (value: unknown): value is CorpusManifestForSearch => {
  if (typeof value !== 'object' || value === null) return false
  const manifest = value as Record<string, unknown>
  return (
    manifest.schemaVersion === CORPUS_SCHEMA_VERSION &&
    typeof manifest.manifestHash === 'string' &&
    Array.isArray(manifest.documents) &&
    manifest.documents.every(isManifestEntry)
  )
}

export type CorpusRefMapFailureCode = 'manifest_unavailable' | 'manifest_incompatible'

export type CorpusRefMapOutcome =
  | { ok: true; resolve: (url: string) => CorpusRefMapEntry | undefined }
  | { ok: false; code: CorpusRefMapFailureCode; message: string; retryable: boolean }

let cached: Promise<CorpusRefMapOutcome> | undefined

export const loadCorpusRefMap = (siteConfig: SiteUrlConfig): Promise<CorpusRefMapOutcome> => {
  if (!cached) {
    const promise = (async (): Promise<CorpusRefMapOutcome> => {
      const locator = readLocator()
      if (!locator) {
        return {
          ok: false,
          code: 'manifest_unavailable',
          message:
            'the #474 documentation corpus plugin has not published a manifest locator (is documentationCorpusPlugin registered in docusaurus.config.ts?)',
          retryable: false
        }
      }

      let response: Response
      try {
        // Same-origin static build asset (the #474 corpus manifest), not a
        // backend API call; none of fetchWithTelemetry's
        // RequestTelemetryMetadata.origin values apply.
        // eslint-disable-next-line no-restricted-globals -- see comment above
        response = await fetch(locator.manifestUrl)
      } catch (error) {
        return {
          ok: false,
          code: 'manifest_unavailable',
          message: `failed to fetch the documentation corpus manifest at "${locator.manifestUrl}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          retryable: true
        }
      }
      if (!response.ok) {
        return {
          ok: false,
          code: 'manifest_unavailable',
          message: `documentation corpus manifest request to "${locator.manifestUrl}" failed with HTTP ${response.status}`,
          retryable: true
        }
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        return {
          ok: false,
          code: 'manifest_incompatible',
          message: `documentation corpus manifest response from "${locator.manifestUrl}" was not valid JSON`,
          retryable: false
        }
      }
      if (!isManifest(payload)) {
        return {
          ok: false,
          code: 'manifest_incompatible',
          message: 'documentation corpus manifest did not match the expected #474 schema',
          retryable: false
        }
      }
      if (payload.manifestHash !== locator.manifestHash) {
        // A locator naming a manifest hash the fetched payload doesn't
        // actually carry means the two were published by different builds
        // (e.g. a stale cached page bundle after a redeploy) — surface this
        // loudly rather than silently resolving hits against a manifest that
        // may no longer describe the live corpus.
        return {
          ok: false,
          code: 'manifest_incompatible',
          message: `documentation corpus manifest hash mismatch: locator referenced "${locator.manifestHash}", fetched manifest reports "${payload.manifestHash}"`,
          retryable: false
        }
      }

      // The pinned search index only ever indexes the canonical (`isLast`)
      // version's pages (see selectCanonicalCorpusVersion in
      // docs-corpus/plugin.ts and easyops' own postBuildFactory.js, which
      // writes only one root index for the last version). The #474 manifest
      // emits every loaded version, so restrict the lookup to `isLast`
      // entries to avoid ever resolving a hit to a historical/upcoming
      // version's document.
      const byPermalink = new Map<string, CorpusRefMapEntry>()
      for (const entry of payload.documents) {
        if (!entry.isLast) continue
        byPermalink.set(normalizePermalink(entry.permalink, siteConfig), entry)
      }

      return {
        ok: true,
        resolve: (url: string) => byPermalink.get(normalizePermalink(url, siteConfig))
      }
    })()
    cached = promise
    // Retryable failures (network/HTTP) must not stick around forever — a
    // later call should get a fresh attempt instead of replaying the same
    // failure until a full page reload. Non-retryable outcomes (success or a
    // genuine incompatibility) are stable and stay cached.
    void promise.then((outcome) => {
      if (!outcome.ok && outcome.retryable && cached === promise) {
        cached = undefined
      }
    })
  }
  return cached
}

/** Test-only: forces the next call to reload/re-fetch instead of reusing the cached promise. */
export const resetCorpusRefMapCacheForTests = (): void => {
  cached = undefined
}
