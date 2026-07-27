/**
 * Runtime store for the #474 documentation corpus manifest.
 *
 * One place in the browser that discovers the corpus locator, fetches and
 * fully validates the manifest, verifies its integrity, caches it, and answers
 * lookups. Every documentation consumer goes through here:
 *
 * - `#475` search projects it down to canonical-version permalinks
 *   (docs-search/corpus-ref-map.ts);
 * - `#477`'s `read_doc` needs the same entries' `artifact`/`artifactHash` to
 *   load a document body, reached by the very `ref` a search result returned.
 *
 * Those two must not disagree about what the corpus is. A second locator
 * reader, validator, cache and retry policy for the same resource is precisely
 * the drift this module exists to prevent, so consumers add projections here
 * rather than re-reading the manifest themselves.
 *
 * The locator is discovered via `@generated/globalData`, Docusaurus' own
 * stable, public plugin-data channel (the same data `useGlobalData` and
 * `usePluginData` read).
 */
import type {
  DocumentationCorpusManifest,
  DocumentationCorpusManifestEntry
} from '@tinytinkerer/app-browser/documentation-corpus'
import { DOCUMENTATION_CORPUS_SCHEMA_VERSION } from '@tinytinkerer/app-browser/documentation-corpus'
import globalData from '@generated/globalData'
import { canonicalizeDocusaurusPermalink } from './docusaurus-compatibility'

const CORPUS_PLUGIN_NAME = 'documentation-corpus'
const CORPUS_PLUGIN_ID = 'default'

type CorpusLocator = { schemaVersion: number; manifestHash: string; manifestUrl: string }

/**
 * The URL settings a lookup is normalized against — the same shape
 * `useDocusaurusContext().siteConfig` exposes.
 */
export type SiteUrlConfig = { baseUrl: string; trailingSlash: boolean | undefined }

export type DocumentationCorpusStoreFailureCode = 'manifest_unavailable' | 'manifest_incompatible'

export type DocumentationCorpusStore = {
  manifest: DocumentationCorpusManifest
  /** Every entry, in manifest order. */
  documents: readonly DocumentationCorpusManifestEntry[]
  /** Canonical-version (`isLast`) entry for a page URL, however it is spelled. */
  findByPermalink: (url: string) => DocumentationCorpusManifestEntry | undefined
  /**
   * Entry for a Docusaurus document id. Without `version`, resolves the
   * canonical (`isLast`) version — the one an unqualified `read_doc(ref)` and
   * every `#475` search result refer to.
   */
  findByRef: (ref: string, version?: string) => DocumentationCorpusManifestEntry | undefined
}

export type DocumentationCorpusStoreOutcome =
  | { ok: true; store: DocumentationCorpusStore }
  | {
      ok: false
      code: DocumentationCorpusStoreFailureCode
      message: string
      retryable: boolean
    }

/**
 * Extracts the pathname before canonicalizing, so an absolute URL (a different
 * origin/scheme than a raw search hit happens to carry) and a bare path both
 * normalize identically; `URL.pathname` already excludes any query string or
 * fragment. The base passed to `URL` only ever resolves a relative path — it
 * never appears in the result.
 */
const toPathname = (value: string): string => {
  try {
    return new URL(value, 'http://localhost').pathname
  } catch {
    return value
  }
}

/**
 * Canonicalizes a URL for lookup. This deliberately does **not** add, strip, or
 * rewrite a base URL or a version path, because neither is ever needed here:
 *
 * - Both producers already emit base-url-prefixed paths. The search plugin's
 *   own `postBuildFactory.js` asserts `doc.u.startsWith(baseUrl)`, and a
 *   Docusaurus `permalink` (what this manifest stores) is base-url-aware by
 *   construction — so with this site's `/docs/` base URL both sides read
 *   `/docs/...` already.
 * - Version paths never diverge either: `findByPermalink` only considers
 *   `isLast` entries, and the search plugin writes exactly one root index
 *   covering that same canonical version.
 *
 * What is left is trailing-slash policy, applied through the exact same
 * `canonicalizeDocusaurusPermalink` helper (a thin wrapper over Docusaurus' own
 * `applyTrailingSlash`, including its base-URL homepage special case) that
 * build-corpus.ts produced these permalinks with — so the two sides cannot
 * drift apart.
 */
const normalizePermalink = (value: string, siteConfig: SiteUrlConfig): string =>
  canonicalizeDocusaurusPermalink(toPathname(value), siteConfig)

/**
 * A locator that is simply absent (the corpus plugin was never registered) is a
 * different operational problem from one that is present but does not match the
 * schema this module was built against — the first is a configuration mistake,
 * the second is corpus/consumer drift. They must not collapse into one code.
 */
type LocatorLookup =
  | { kind: 'ok'; locator: CorpusLocator }
  | { kind: 'absent' }
  | { kind: 'malformed' }
  | { kind: 'incompatible_version'; schemaVersion: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isLocatorShape = (value: unknown): value is CorpusLocator =>
  isRecord(value) &&
  typeof value.manifestUrl === 'string' &&
  typeof value.schemaVersion === 'number' &&
  typeof value.manifestHash === 'string'

const readLocator = (): LocatorLookup => {
  const pluginData = (globalData as unknown as Record<string, Record<string, unknown> | undefined>)[
    CORPUS_PLUGIN_NAME
  ]
  const locator = pluginData?.[CORPUS_PLUGIN_ID]
  if (locator === undefined || locator === null) return { kind: 'absent' }
  if (!isLocatorShape(locator)) return { kind: 'malformed' }
  if (locator.schemaVersion !== DOCUMENTATION_CORPUS_SCHEMA_VERSION) {
    return { kind: 'incompatible_version', schemaVersion: locator.schemaVersion }
  }
  return { kind: 'ok', locator }
}

/**
 * Validates the **complete** `DocumentationCorpusManifestEntry` contract, not
 * just the fields the current caller happens to read. A projection that
 * validated only its own slice would let a consumer added later (e.g. #477
 * reaching for `artifact`) trust a field nothing ever checked.
 */
const isManifestEntry = (value: unknown): value is DocumentationCorpusManifestEntry => {
  if (!isRecord(value)) return false
  return (
    typeof value.ref === 'string' &&
    typeof value.version === 'string' &&
    typeof value.versionPath === 'string' &&
    typeof value.isLast === 'boolean' &&
    typeof value.title === 'string' &&
    typeof value.permalink === 'string' &&
    typeof value.source === 'string' &&
    typeof value.contentHash === 'string' &&
    typeof value.artifactHash === 'string' &&
    typeof value.unlisted === 'boolean' &&
    typeof value.artifact === 'string' &&
    typeof value.characterCount === 'number' &&
    Number.isInteger(value.characterCount) &&
    typeof value.sectionCount === 'number' &&
    Number.isInteger(value.sectionCount)
  )
}

const isManifest = (value: unknown): value is DocumentationCorpusManifest =>
  isRecord(value) &&
  value.schemaVersion === DOCUMENTATION_CORPUS_SCHEMA_VERSION &&
  typeof value.manifestHash === 'string' &&
  Array.isArray(value.documents) &&
  value.documents.every(isManifestEntry)

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/**
 * Recomputes the manifest's own advertised hash.
 *
 * Comparing the locator's `manifestHash` against the payload's only catches a
 * stale *pairing* — both are self-reported, so a payload whose entries changed
 * while keeping the advertised string is accepted, under a URL that is supposed
 * to be content-addressed. This recomputes SHA-256 over exactly what
 * build-corpus.ts hashed: `JSON.stringify({ schemaVersion, documents })`, the
 * manifest without its own hash field.
 *
 * Returns `undefined` when the platform offers no `crypto.subtle` — it is
 * restricted to secure contexts, so a docs site served over plain HTTP would
 * otherwise lose search entirely. The caller degrades to the string comparison
 * in that case rather than failing.
 */
const computeManifestHash = async (
  manifest: DocumentationCorpusManifest
): Promise<string | undefined> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  const canonical = JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    documents: manifest.documents
  })
  try {
    return toHex(await subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  } catch {
    return undefined
  }
}

/**
 * Keyed by everything that changes the resolved store: which manifest is being
 * read (URL + hash) and how URLs are normalized against it (base URL +
 * trailing-slash policy). An unkeyed cache would let the first caller's site
 * config silently decide every later caller's normalization.
 *
 * The parts are joined with an escaped NUL, which cannot occur in a URL, a
 * content hash, or a boolean, so no two distinct inputs can collide on one key.
 */
const cacheKeyOf = (lookup: LocatorLookup, siteConfig: SiteUrlConfig): string => {
  const locatorKey =
    lookup.kind === 'ok'
      ? `${lookup.locator.manifestUrl}\u0000${lookup.locator.manifestHash}`
      : lookup.kind
  return `${locatorKey}\u0000${siteConfig.baseUrl}\u0000${String(siteConfig.trailingSlash)}`
}

const cache = new Map<string, Promise<DocumentationCorpusStoreOutcome>>()

const buildStore = (
  manifest: DocumentationCorpusManifest,
  siteConfig: SiteUrlConfig
): DocumentationCorpusStore => {
  // The canonical (`isLast`) version is what an unqualified `read_doc(ref)` and
  // every #475 search hit refer to; the manifest also carries historical and
  // upcoming versions, which must never be resolved by accident.
  const canonicalByPermalink = new Map<string, DocumentationCorpusManifestEntry>()
  const canonicalByRef = new Map<string, DocumentationCorpusManifestEntry>()
  const byVersionAndRef = new Map<string, DocumentationCorpusManifestEntry>()

  for (const entry of manifest.documents) {
    byVersionAndRef.set(`${entry.version}\u0000${entry.ref}`, entry)
    if (!entry.isLast) continue
    canonicalByPermalink.set(normalizePermalink(entry.permalink, siteConfig), entry)
    canonicalByRef.set(entry.ref, entry)
  }

  return {
    manifest,
    documents: manifest.documents,
    findByPermalink: (url) => canonicalByPermalink.get(normalizePermalink(url, siteConfig)),
    findByRef: (ref, version) =>
      version === undefined
        ? canonicalByRef.get(ref)
        : byVersionAndRef.get(`${version}\u0000${ref}`)
  }
}

const loadStore = async (
  lookup: LocatorLookup,
  siteConfig: SiteUrlConfig
): Promise<DocumentationCorpusStoreOutcome> => {
  if (lookup.kind === 'absent') {
    return {
      ok: false,
      code: 'manifest_unavailable',
      message:
        'the #474 documentation corpus plugin has not published a manifest locator (is documentationCorpusPlugin registered in docusaurus.config.ts?)',
      retryable: false
    }
  }
  if (lookup.kind === 'malformed') {
    return {
      ok: false,
      code: 'manifest_incompatible',
      message:
        'the #474 documentation corpus plugin published a manifest locator missing a schemaVersion, manifestHash, or manifestUrl',
      retryable: false
    }
  }
  if (lookup.kind === 'incompatible_version') {
    return {
      ok: false,
      code: 'manifest_incompatible',
      message: `the #474 documentation corpus locator declares schema version ${String(
        lookup.schemaVersion
      )}, but this consumer was built against ${DOCUMENTATION_CORPUS_SCHEMA_VERSION}`,
      retryable: false
    }
  }
  const { locator } = lookup

  let response: Response
  try {
    // Same-origin static build asset (the #474 corpus manifest), not a backend
    // API call; none of fetchWithTelemetry's RequestTelemetryMetadata.origin
    // values apply.
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
    // A locator naming a manifest hash the fetched payload doesn't actually
    // carry means the two were published by different builds (e.g. a stale
    // cached page bundle after a redeploy) — surface this loudly rather than
    // silently resolving against a manifest that may no longer describe the
    // live corpus.
    return {
      ok: false,
      code: 'manifest_incompatible',
      message: `documentation corpus manifest hash mismatch: locator referenced "${locator.manifestHash}", fetched manifest reports "${payload.manifestHash}"`,
      retryable: false
    }
  }

  const computed = await computeManifestHash(payload)
  if (computed !== undefined && computed !== payload.manifestHash) {
    return {
      ok: false,
      code: 'manifest_incompatible',
      message: `documentation corpus manifest failed integrity verification: its contents hash to "${computed}" but it advertises "${payload.manifestHash}"`,
      retryable: false
    }
  }

  return { ok: true, store: buildStore(payload, siteConfig) }
}

/**
 * Loads (or returns the cached) corpus manifest store for a site configuration.
 * Safe to call from any consumer on every operation — concurrent callers
 * coalesce onto one fetch.
 */
export const loadDocumentationCorpusStore = (
  siteConfig: SiteUrlConfig
): Promise<DocumentationCorpusStoreOutcome> => {
  const lookup = readLocator()
  const key = cacheKeyOf(lookup, siteConfig)
  const existing = cache.get(key)
  if (existing) return existing

  const promise = loadStore(lookup, siteConfig)
  cache.set(key, promise)
  // Retryable failures (network/HTTP) must not stick around forever — a later
  // call should get a fresh attempt instead of replaying the same failure until
  // a full page reload. Unlike the search worker's own internal index cache
  // (see docs-search/private-worker-adapter.ts), this cache is ours, so we can
  // and do evict it. The identity check keeps a newer in-flight promise from
  // being dropped.
  void promise.then((outcome) => {
    if (!outcome.ok && outcome.retryable && cache.get(key) === promise) {
      cache.delete(key)
    }
  })
  return promise
}

/** Test-only: forces the next call to reload/re-fetch instead of reusing a cached promise. */
export const resetDocumentationCorpusStoreForTests = (): void => {
  cache.clear()
}
