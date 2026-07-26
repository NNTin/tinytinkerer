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
import type {
  DocumentationCorpusManifest,
  DocumentationCorpusManifestEntry
} from '@tinytinkerer/app-browser'
import globalData from '@generated/globalData'

const CORPUS_PLUGIN_NAME = 'documentation-corpus'
const CORPUS_PLUGIN_ID = 'default'
const CORPUS_SCHEMA_VERSION = 1

type CorpusLocator = { schemaVersion: number; manifestHash: string; manifestUrl: string }

// Trailing-slash tolerant so a hit's raw page URL and a manifest permalink
// compare equal regardless of `trailingSlash` config drift between the two
// producers of these strings.
const normalizePermalink = (value: string): string => {
  const trimmed = value.replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : '/'
}

const isLocator = (value: unknown): value is CorpusLocator =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).manifestUrl === 'string' &&
  typeof (value as Record<string, unknown>).schemaVersion === 'number'

const readLocator = (): CorpusLocator | undefined => {
  const pluginData = (globalData as unknown as Record<string, Record<string, unknown> | undefined>)[
    CORPUS_PLUGIN_NAME
  ]
  const locator = pluginData?.[CORPUS_PLUGIN_ID]
  return isLocator(locator) ? locator : undefined
}

const isManifestEntry = (value: unknown): value is DocumentationCorpusManifestEntry => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.ref === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.permalink === 'string' &&
    typeof entry.unlisted === 'boolean'
  )
}

const isManifest = (value: unknown): value is DocumentationCorpusManifest => {
  if (typeof value !== 'object' || value === null) return false
  const manifest = value as Record<string, unknown>
  return (
    manifest.schemaVersion === CORPUS_SCHEMA_VERSION &&
    Array.isArray(manifest.documents) &&
    manifest.documents.every(isManifestEntry)
  )
}

export type CorpusRefMapFailureCode = 'manifest_unavailable' | 'manifest_incompatible'

export type CorpusRefMapOutcome =
  | { ok: true; resolve: (url: string) => DocumentationCorpusManifestEntry | undefined }
  | { ok: false; code: CorpusRefMapFailureCode; message: string; retryable: boolean }

let cached: Promise<CorpusRefMapOutcome> | undefined

export const loadCorpusRefMap = (): Promise<CorpusRefMapOutcome> => {
  if (!cached) {
    cached = (async (): Promise<CorpusRefMapOutcome> => {
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

      const byPermalink = new Map<string, DocumentationCorpusManifestEntry>()
      for (const entry of payload.documents) {
        byPermalink.set(normalizePermalink(entry.permalink), entry)
      }

      return {
        ok: true,
        resolve: (url: string) => byPermalink.get(normalizePermalink(url))
      }
    })()
  }
  return cached
}

/** Test-only: forces the next call to reload/re-fetch instead of reusing the cached promise. */
export const resetCorpusRefMapCacheForTests = (): void => {
  cached = undefined
}
