/**
 * Runtime loader for #474 document artifacts — the lazy half of the corpus.
 *
 * `manifest-store.ts` answers *which* document a ref or a URL is; this answers
 * *what it says*. They are deliberately separate resources: the manifest is one
 * small request every documentation page makes, while a document body is
 * fetched only when a read operation actually needs it. #474's acceptance
 * criterion "initial docs-page loading fetches the manifest at most; document
 * bodies are fetched only by a read operation" is this module's whole reason to
 * exist as its own store rather than a projection on the manifest one.
 *
 * Everything else follows manifest-store.ts's precedent on purpose, so the two
 * cannot develop different ideas about integrity or caching:
 *
 * - the **complete** artifact contract is validated, not the slice today's
 *   caller reads;
 * - integrity is *recomputed*, not taken on trust — the artifact URL is
 *   content-addressed by `artifactHash`, so verifying the fetched bytes against
 *   it is the only check that means anything;
 * - retryable (network/HTTP) failures are evicted from the cache immediately;
 *   schema and integrity failures are stable and stay cached.
 */
import type {
  DocumentationCorpusDocumentArtifact,
  DocumentationCorpusLoadFailure,
  DocumentationCorpusManifestEntry,
  DocumentationCorpusOutlineItem,
  DocumentationCorpusSection
} from '@tinytinkerer/app-browser/documentation-corpus'
import { DOCUMENTATION_CORPUS_SCHEMA_VERSION } from '@tinytinkerer/app-browser/documentation-corpus'

export type DocumentationCorpusArtifactOutcome =
  | { ok: true; artifact: DocumentationCorpusDocumentArtifact }
  | DocumentationCorpusLoadFailure

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isSection = (value: unknown): value is DocumentationCorpusSection =>
  isRecord(value) &&
  Number.isInteger(value.index) &&
  (value.anchor === null || typeof value.anchor === 'string') &&
  typeof value.title === 'string' &&
  Number.isInteger(value.depth) &&
  (value.parentAnchor === null || typeof value.parentAnchor === 'string') &&
  Number.isInteger(value.startOffset) &&
  Number.isInteger(value.contentStartOffset) &&
  Number.isInteger(value.endOffset) &&
  typeof value.selectionPrefix === 'string' &&
  typeof value.selectionSuffix === 'string' &&
  Number.isInteger(value.characterCount)

const isOutlineItem = (value: unknown): value is DocumentationCorpusOutlineItem =>
  isRecord(value) &&
  typeof value.anchor === 'string' &&
  typeof value.title === 'string' &&
  Number.isInteger(value.depth) &&
  Number.isInteger(value.sectionIndex) &&
  Array.isArray(value.children) &&
  value.children.every(isOutlineItem)

/**
 * Validates the whole `DocumentationCorpusDocumentArtifact` contract, including
 * the offset invariants a selection depends on. A section whose offsets run
 * backwards or past the end of `markdown` would not throw when sliced — it would
 * quietly return the wrong text, or nothing, which is worse than a typed
 * failure.
 */
const isArtifact = (value: unknown): value is DocumentationCorpusDocumentArtifact => {
  if (!isRecord(value)) return false
  if (
    value.schemaVersion !== DOCUMENTATION_CORPUS_SCHEMA_VERSION ||
    typeof value.ref !== 'string' ||
    typeof value.version !== 'string' ||
    typeof value.contentHash !== 'string' ||
    !Number.isInteger(value.characterCount) ||
    typeof value.markdown !== 'string' ||
    !Array.isArray(value.outline) ||
    !value.outline.every(isOutlineItem) ||
    !Array.isArray(value.sections) ||
    !value.sections.every(isSection)
  ) {
    return false
  }
  const { markdown, sections } = value as {
    markdown: string
    sections: DocumentationCorpusSection[]
  }
  return sections.every(
    (section) =>
      section.startOffset >= 0 &&
      section.startOffset <= section.contentStartOffset &&
      section.contentStartOffset <= section.endOffset &&
      section.endOffset <= markdown.length
  )
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/**
 * SHA-256 of the fetched bytes, or `undefined` where the platform offers no
 * `crypto.subtle` (it is secure-context only, so a docs site served over plain
 * HTTP would otherwise lose reads entirely). The caller degrades to the
 * self-reported cross-checks below rather than failing — the same trade
 * `manifest-store.ts` makes.
 */
const sha256 = async (text: string): Promise<string | undefined> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return undefined
  try {
    return toHex(await subtle.digest('SHA-256', new TextEncoder().encode(text)))
  } catch {
    return undefined
  }
}

const failure = (
  code: DocumentationCorpusLoadFailure['code'],
  message: string,
  retryable: boolean,
  entry: DocumentationCorpusManifestEntry
): DocumentationCorpusLoadFailure => ({
  ok: false,
  kind: 'documentation_corpus_load_failure',
  code,
  message,
  retryable,
  ref: entry.ref,
  artifact: entry.artifact
})

const loadArtifact = async (
  entry: DocumentationCorpusManifestEntry
): Promise<DocumentationCorpusArtifactOutcome> => {
  let response: Response
  try {
    // Same-origin static build asset (a #474 document artifact), not a backend
    // API call; none of fetchWithTelemetry's RequestTelemetryMetadata.origin
    // values apply.
    // eslint-disable-next-line no-restricted-globals -- see comment above
    response = await fetch(entry.artifact)
  } catch (error) {
    return failure(
      'document_unavailable',
      `failed to fetch the documentation artifact for "${entry.ref}" at "${entry.artifact}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      true,
      entry
    )
  }
  if (!response.ok) {
    return failure(
      'document_unavailable',
      `documentation artifact request for "${entry.ref}" at "${entry.artifact}" failed with HTTP ${response.status}`,
      true,
      entry
    )
  }

  // Read as text, not `.json()`: the artifact URL is content-addressed by a hash
  // over the exact serialized bytes, so verifying those bytes is the only check
  // that proves the payload is the one the manifest is describing. Parsing first
  // would discard the very thing being verified.
  let bytes: string
  try {
    bytes = await response.text()
  } catch (error) {
    return failure(
      'document_unavailable',
      `failed to read the documentation artifact body for "${entry.ref}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      true,
      entry
    )
  }

  const computed = await sha256(bytes)
  if (computed !== undefined && computed !== entry.artifactHash) {
    return failure(
      'content_hash_mismatch',
      `documentation artifact for "${entry.ref}" failed integrity verification: its bytes hash to "${computed}" but the manifest records "${entry.artifactHash}"`,
      false,
      entry
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(bytes)
  } catch {
    return failure(
      'document_invalid',
      `documentation artifact for "${entry.ref}" at "${entry.artifact}" was not valid JSON`,
      false,
      entry
    )
  }
  if (!isArtifact(payload)) {
    return failure(
      'document_invalid',
      `documentation artifact for "${entry.ref}" did not match the expected #474 schema`,
      false,
      entry
    )
  }

  // Cross-checks that still hold where `crypto.subtle` is unavailable. They are
  // weaker than the byte hash above (all three values are self-reported), but
  // they do catch the artifact that was served for a *different* document — the
  // one failure mode a plain "did it parse?" check would let through.
  if (payload.ref !== entry.ref || payload.version !== entry.version) {
    return failure(
      'document_invalid',
      `documentation artifact at "${entry.artifact}" identifies itself as "${payload.version}/${payload.ref}", but the manifest requested "${entry.version}/${entry.ref}"`,
      false,
      entry
    )
  }
  if (payload.contentHash !== entry.contentHash) {
    return failure(
      'content_hash_mismatch',
      `documentation artifact for "${entry.ref}" reports content hash "${payload.contentHash}", but the manifest records "${entry.contentHash}"`,
      false,
      entry
    )
  }

  return { ok: true, artifact: payload }
}

/**
 * Keyed by the artifact URL alone. That URL embeds a hash of the complete
 * serialized artifact (see `artifactFileName` in build-corpus.ts), so it already
 * changes whenever the content does — unlike the manifest store's key, nothing
 * about site config participates in resolving an artifact.
 */
const cache = new Map<string, Promise<DocumentationCorpusArtifactOutcome>>()

/**
 * Loads (or returns the cached) document artifact for a manifest entry.
 * Concurrent callers for the same document coalesce onto one fetch.
 */
export const loadDocumentationArtifact = (
  entry: DocumentationCorpusManifestEntry
): Promise<DocumentationCorpusArtifactOutcome> => {
  const key = entry.artifact
  const existing = cache.get(key)
  if (existing) return existing

  const promise = loadArtifact(entry)
  cache.set(key, promise)
  // Retryable failures must not stick for the page lifetime — the docs
  // assistant is mounted for the whole SPA session, so a single transient 503
  // would otherwise make a document permanently unreadable. Schema and
  // integrity failures are stable and stay cached. The identity check keeps a
  // newer in-flight promise from being dropped.
  void promise.then((outcome) => {
    if (!outcome.ok && outcome.retryable && cache.get(key) === promise) {
      cache.delete(key)
    }
  })
  return promise
}

/** Test-only: forces the next call to re-fetch instead of reusing a cached promise. */
export const resetDocumentationArtifactStoreForTests = (): void => {
  cache.clear()
}
