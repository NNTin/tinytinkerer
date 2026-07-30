/**
 * The public contracts of the three documentation tools (#477).
 *
 * These are the schemas the runtime enforces in both directions: `schema` is
 * what `ToolRegistry.run` parses a model's arguments with (and what the
 * planner-visible JSON Schema is generated from, so the model can never be shown
 * a shape the tool does not accept), and `outputSchema` is an **enforcement
 * point** — the registry throws when a result fails it. Every object is
 * `.strict()`, so an extra or misspelled key is a hard failure rather than a
 * field that silently rides along.
 *
 * Discriminants are spelled `status`, matching the locked issue text, rather
 * than the `ok: boolean` of the #474/#475 wire contracts these compose. That is
 * deliberate: a model branches better on a named string than on a boolean plus a
 * code, and the tool boundary is where the two vocabularies meet.
 */
import { z } from 'zod'

/** Locked by #477. A caller asking for more is clamped, not rejected. */
export const MAX_READ_CHARS = 20_000

const MIN_QUERY_CHARS = 2
const MAX_QUERY_CHARS = 500

const MAX_SEARCH_RESULTS = 10
const DEFAULT_SEARCH_RESULTS = 5

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const searchDocsInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(MIN_QUERY_CHARS)
      .max(MAX_QUERY_CHARS)
      .describe(
        'What to look for in the TinyTinkerer documentation. Natural language or keywords; ' +
          `${MIN_QUERY_CHARS}-${MAX_QUERY_CHARS} characters.`
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_RESULTS)
      .default(DEFAULT_SEARCH_RESULTS)
      .describe(
        `How many documentation pages to return (1-${MAX_SEARCH_RESULTS}). Results are unique ` +
          'pages, ordered by relevance.'
      )
  })
  .strict()

export type SearchDocsInput = z.infer<typeof searchDocsInputSchema>

/**
 * `maxChars` is a positive integer with no upper bound in the schema, and is
 * **clamped** to `MAX_READ_CHARS` by the tool. #477 requires that no response
 * exceed the enforced output limit "even if a caller supplies a larger
 * `maxChars`" — that describes bounding the response, not failing the call, and
 * a model that overshoots should get the documentation rather than a validation
 * error it has to guess its way out of.
 */
const maxCharsSchema = z
  .number()
  .int()
  .positive()
  .optional()
  .describe(
    `Maximum characters of Markdown to return. Values above ${MAX_READ_CHARS} are clamped to it.`
  )

const anchorSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    'A section anchor from this document\'s `outline` (no leading "#"). Omit to read the whole ' +
      'document, which returns a balanced overview when it is too large to return in full.'
  )

export const readCurrentDocInputSchema = z
  .object({ anchor: anchorSchema, maxChars: maxCharsSchema })
  .strict()

export type ReadCurrentDocInput = z.infer<typeof readCurrentDocInputSchema>

export const readDocInputSchema = z
  .object({
    ref: z
      .string()
      .trim()
      .min(1)
      .describe(
        'The documentation `ref` of the page to read, exactly as returned by `search_docs` or by ' +
          'a previous read. This is a corpus document id, not a URL — no URL is ever fetched.'
      ),
    anchor: anchorSchema,
    maxChars: maxCharsSchema
  })
  .strict()

export type ReadDocInput = z.infer<typeof readDocInputSchema>

// ---------------------------------------------------------------------------
// Shared output pieces
// ---------------------------------------------------------------------------

/**
 * `version`/`isLast` are carried even though this site loads a single
 * documentation version. Artifacts are per-version and #476's active-document
 * identity already knows which one a route belongs to; without them,
 * `read_current_doc` on a historical route would hand back a `ref` that
 * `read_doc(ref)` resolves to the canonical version — different content, with
 * nothing in the response to reveal it. See docs-tools/README.md.
 */
const documentIdentitySchema = z
  .object({
    ref: z.string(),
    version: z.string(),
    isLast: z.boolean(),
    title: z.string(),
    permalink: z.string(),
    unlisted: z.boolean()
  })
  .strict()

const outlineEntrySchema = z
  .object({ heading: z.string(), level: z.number().int(), anchor: z.string() })
  .strict()

/** Authored source Markdown, kept in its own field so it is never confused with tool metadata. */
const readSectionSchema = z
  .object({
    heading: z.string().optional(),
    anchor: z.string().optional(),
    markdown: z.string()
  })
  .strict()

/**
 * #474's shared bounded-read metadata, which `docs-corpus/README.md` requires a
 * bounded reader to return rather than silently cutting text. The locked issue
 * shape carries only `truncated`; both are present, because
 * `nextSectionAnchor` is what turns "there is more" into a follow-up call the
 * model can actually make.
 */
const readTruncationSchema = z
  .object({
    truncated: z.boolean(),
    sourceCharacterCount: z.number().int().nonnegative(),
    returnedCharacterCount: z.number().int().nonnegative(),
    omittedCharacterCount: z.number().int().nonnegative(),
    nextSectionAnchor: z.string().nullable()
  })
  .strict()

const readOkSchema = z
  .object({
    status: z.literal('ok'),
    doc: documentIdentitySchema,
    selection: z.enum(['full', 'balanced_overview', 'section']),
    outline: z.array(outlineEntrySchema),
    sections: z.array(readSectionSchema),
    truncated: z.boolean(),
    truncation: readTruncationSchema
  })
  .strict()

/** #474's corpus-load failure vocabulary, forwarded rather than re-coded. */
export type ReadErrorCode = z.infer<typeof readErrorCodeSchema>

const readErrorCodeSchema = z.enum([
  'manifest_unavailable',
  'manifest_incompatible',
  'document_not_found',
  'document_unavailable',
  'document_invalid',
  'content_hash_mismatch',
  'section_not_found'
])

/**
 * A read that failed after the document to read was known. `outline` is present
 * for `section_not_found` specifically, so an invalid anchor tells the model
 * which anchors do exist instead of leaving it to guess again.
 */
const readErrorSchema = z
  .object({
    status: z.literal('error'),
    code: readErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    ref: z.string().optional(),
    outline: z.array(outlineEntrySchema).optional()
  })
  .strict()

// ---------------------------------------------------------------------------
// Tool outputs
// ---------------------------------------------------------------------------

export const readDocOutputSchema = z.discriminatedUnion('status', [readOkSchema, readErrorSchema])

export type ReadDocOutput = z.infer<typeof readDocOutputSchema>

/** The route genuinely has no authored document — `/search`, a 404, a generated index. */
const notOnDocPageSchema = z
  .object({
    status: z.literal('not_on_doc_page'),
    pathname: z.string(),
    message: z.string()
  })
  .strict()

/**
 * Identity could not be established: the corpus has not loaded, could not be
 * loaded, does not match this build, or reports a document the corpus has never
 * heard of. Kept apart from `not_on_doc_page` because telling a reader "this is
 * not a documentation page" when retrieval is broken is both false and
 * unactionable — see the owner decision on #477.
 */
const currentDocUnavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    pathname: z.string(),
    reason: z.enum([
      'corpus_pending',
      'corpus_unavailable',
      'corpus_incompatible',
      'unknown_active_document'
    ]),
    message: z.string(),
    retryable: z.boolean()
  })
  .strict()

export const readCurrentDocOutputSchema = z.discriminatedUnion('status', [
  readOkSchema,
  readErrorSchema,
  notOnDocPageSchema,
  currentDocUnavailableSchema
])

export type ReadCurrentDocOutput = z.infer<typeof readCurrentDocOutputSchema>

/**
 * `section`/`anchor` are omitted rather than null when #475 has none: the locked
 * result shape declares them optional, and under a strict schema a null would be
 * a different (rejected) thing.
 */
const searchResultSchema = z
  .object({
    ref: z.string(),
    title: z.string(),
    permalink: z.string(),
    section: z.string().optional(),
    anchor: z.string().optional(),
    snippet: z.string()
  })
  .strict()

const searchOkSchema = z
  .object({
    status: z.literal('ok'),
    query: z.string(),
    results: z.array(searchResultSchema)
  })
  .strict()

/**
 * One failure variant carrying #475's own code verbatim, the same shape
 * `docs-search/corpus-ref-map.ts` forwards a store code with. An empty
 * `results` array on a successful search is a legitimate zero-result answer and
 * is never reported through here.
 */
const searchUnavailableSchema = z
  .object({
    status: z.literal('search_unavailable'),
    code: z.enum([
      'index_dev_unsupported',
      'index_unavailable',
      'index_incompatible',
      'manifest_unavailable',
      'manifest_incompatible'
    ]),
    message: z.string(),
    retryable: z.boolean()
  })
  .strict()

export const searchDocsOutputSchema = z.discriminatedUnion('status', [
  searchOkSchema,
  searchUnavailableSchema
])

export type SearchDocsOutput = z.infer<typeof searchDocsOutputSchema>
