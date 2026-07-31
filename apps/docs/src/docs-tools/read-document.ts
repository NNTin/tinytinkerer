/**
 * The one read pipeline behind both `read_doc` and `read_current_doc`.
 *
 * Manifest entry → document artifact → bounded selection → a response fitted to
 * the transport's per-message limit. The two tools differ only in how they
 * arrive at a `(ref, version)`: one is told, the other asks #476 which document
 * the reader is on. Everything after that — including every failure the reader
 * can be told about — is shared, so the two cannot answer the same question
 * differently.
 *
 * Nothing here fetches a URL a caller supplied. The only thing fetched is the
 * `artifact` location the #474 manifest records for a ref it already contains,
 * which is what makes "accepts only a corpus ref; it must not fetch an arbitrary
 * URL" a structural property rather than a validation rule.
 */
import type { DocumentationCorpusDocumentArtifact } from '@tinytinkerer/app-browser/documentation-corpus'
import { loadDocumentationArtifact } from '../docs-corpus/artifact-store'
import { loadDocumentationCorpusStore, type SiteUrlConfig } from '../docs-corpus/manifest-store'
import { MAX_READ_CHARS, type ReadDocOutput, type ReadErrorCode } from './schemas'
import {
  boundedMessage,
  fitToResponseCap,
  RESPONSE_CHARACTER_CAP,
  serializedLength
} from './response-cap'
import {
  flattenOutline,
  selectDocument,
  selectSection,
  type DocumentationOutlineEntry
} from './selection'

export type ReadDocumentRequest = {
  ref: string
  /** Reads the canonical (`isLast`) version when omitted. */
  version?: string
  anchor?: string
  maxChars?: number
}

/** A model may well write the fragment the way it appears in a URL. */
const normalizeAnchor = (anchor: string): string => anchor.trim().replace(/^#+/, '')

/**
 * Every failure goes through here, so none can be built without its message
 * bounded — the messages quote model-supplied identifiers and upstream error
 * text, neither of which this code chose the length of.
 */
const error = (
  code: ReadErrorCode,
  message: string,
  retryable: boolean,
  extra: { ref?: string; outline?: DocumentationOutlineEntry[] } = {}
): ReadDocOutput =>
  fitFailure({
    status: 'error',
    code,
    message: boundedMessage(message),
    retryable,
    ...extra,
    // Bounded here too, not only by the input schema: `readDocument` is also
    // reachable from `read_current_doc`, and a bound that lives in one caller's
    // schema is not a bound on this function.
    ...(extra.ref === undefined ? {} : { ref: boundedMessage(extra.ref) })
  })

/**
 * Fits a typed failure to the response cap.
 *
 * A failure that overran the limit would be cut mid-JSON by the transport,
 * which defeats the entire point of a typed, discriminated failure: the model
 * would receive an unparseable fragment instead of an actionable error. The
 * outline is the only unbounded part left once the message is bounded, so it is
 * dropped rather than the failure being mangled.
 */
const fitFailure = (payload: ReadDocOutput): ReadDocOutput => {
  if (payload.status !== 'error') return payload
  if (serializedLength(payload) <= RESPONSE_CHARACTER_CAP) return payload

  let outline = payload.outline ?? []
  let candidate: ReadDocOutput = payload
  while (serializedLength(candidate) > RESPONSE_CHARACTER_CAP && outline.length > 0) {
    outline = outline.slice(0, Math.floor(outline.length / 2))
    candidate = { ...payload, outline }
  }
  if (serializedLength(candidate) > RESPONSE_CHARACTER_CAP) {
    candidate = { ...payload, outline: undefined }
  }
  return candidate
}

/**
 * Last-resort guard for a successful payload whose *fixed* parts overrun the cap
 * — a document with a pathologically large outline. Shrinking Markdown cannot
 * help there, so the outline is trimmed instead.
 *
 * Reported through its own `outlineTruncated` flag, never through the content
 * truncation fields: those describe the document text, and overloading them
 * would produce `truncated: true` beside `omittedCharacterCount: 0` while the
 * thing actually omitted was metadata.
 *
 * This site's largest document has 15 headings, so nothing here exercises it
 * today; it exists because the acceptance criterion is absolute and the failure
 * mode is invisible.
 */
const trimOutlineToFit = (payload: ReadDocOutput): ReadDocOutput => {
  if (payload.status !== 'ok') return payload
  let outline = payload.outline
  let candidate = payload
  while (serializedLength(candidate) > RESPONSE_CHARACTER_CAP && outline.length > 0) {
    outline = outline.slice(0, Math.floor(outline.length / 2))
    candidate = { ...payload, outline, outlineTruncated: true }
  }
  return candidate
}

const buildRead = (
  artifact: DocumentationCorpusDocumentArtifact,
  identity: Extract<ReadDocOutput, { status: 'ok' }>['doc'],
  outline: DocumentationOutlineEntry[],
  anchoredSectionIndex: number | undefined,
  budget: number
): ReadDocOutput => {
  const selection =
    anchoredSectionIndex === undefined
      ? selectDocument(artifact, budget)
      : selectSection(artifact, artifact.sections[anchoredSectionIndex], budget)

  return {
    status: 'ok',
    doc: identity,
    selection: selection.selection,
    outline,
    sections: selection.sections,
    truncated: selection.truncation.truncated,
    truncation: selection.truncation,
    outlineTruncated: false
  }
}

export const readDocument = async (
  siteConfig: SiteUrlConfig,
  request: ReadDocumentRequest
): Promise<ReadDocOutput> => {
  // Clamped rather than rejected: #477 requires the response to be bounded even
  // when a caller asks for more, and a model that overshoots should get the
  // documentation instead of a validation error to reason its way out of.
  const requested = request.maxChars ?? MAX_READ_CHARS
  const budget = Math.max(1, Math.min(requested, MAX_READ_CHARS))

  const storeOutcome = await loadDocumentationCorpusStore(siteConfig)
  if (!storeOutcome.ok) {
    return error(storeOutcome.code, storeOutcome.message, storeOutcome.retryable, {
      ref: request.ref
    })
  }

  const entry = storeOutcome.store.findByRef(request.ref, request.version)
  if (!entry) {
    return error(
      'document_not_found',
      `no documentation page has the ref "${request.ref}". Refs come from search_docs results or ` +
        'a previous read; use search_docs to find the right page.',
      false,
      { ref: request.ref }
    )
  }

  const artifactOutcome = await loadDocumentationArtifact(entry)
  if (!artifactOutcome.ok) {
    return error(artifactOutcome.code, artifactOutcome.message, artifactOutcome.retryable, {
      ref: entry.ref
    })
  }
  const { artifact } = artifactOutcome
  const outline = flattenOutline(artifact.outline)

  let anchoredSectionIndex: number | undefined
  if (request.anchor !== undefined) {
    const anchor = normalizeAnchor(request.anchor)
    const index = artifact.sections.findIndex((section) => section.anchor === anchor)
    if (index < 0) {
      // The outline travels with the failure so an invalid anchor becomes a
      // retryable-by-the-model situation rather than another guess: #477
      // requires exactly this.
      return error(
        'section_not_found',
        `"${entry.ref}" has no section anchored "${anchor}". Its available anchors are listed in ` +
          "this response's `outline`; retry with one of them, or omit `anchor` to read the page.",
        false,
        { ref: entry.ref, outline }
      )
    }
    anchoredSectionIndex = index
  }

  const identity = {
    ref: entry.ref,
    version: entry.version,
    isLast: entry.isLast,
    title: entry.title,
    permalink: entry.permalink,
    unlisted: entry.unlisted
  }

  return trimOutlineToFit(
    fitToResponseCap(
      (attemptBudget) =>
        buildRead(artifact, identity, outline, anchoredSectionIndex, attemptBudget),
      budget
    )
  )
}
