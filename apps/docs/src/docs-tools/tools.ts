/**
 * The three documentation tools and the `Documentation` app tool group that
 * carries them (#477).
 *
 * They travel to the runtime as an `AppToolGroup` — the same mechanism
 * `apps/canvas` and `apps/mermaid` use for their stage verbs, and the same one
 * the docs tool-picker lab uses — rather than as a plugin. `apps/docs` still
 * cannot name a concrete `@tinytinkerer/plugin-*` package
 * (scripts/check-boundaries.mjs forbids it; only `@tinytinkerer/catalogue` may),
 * but since issue #495 that is no longer the deciding reason: docs DOES carry
 * plugins now, through an injected catalogue. An app group remains the right
 * shape here because it has no activation toggle, and the documentation tools
 * are intrinsic to the documentation assistant — they are not something a reader
 * should be able to switch off wholesale. Individual tools remain independently
 * controllable through the ordinary tool picker's per-tool disablement.
 *
 * `siteConfig` is injected rather than read, because a `Tool` is a plain object
 * whose `execute` runs outside React and outside Docusaurus' context. #479
 * supplies it when it builds the assistant `BrowserApp`; the default reads
 * whatever #476 last published, so the tools work wherever the provider is
 * mounted.
 */
import type { AppToolGroup, Tool } from '@tinytinkerer/app-browser'
import { searchDocumentation } from '../docs-search/search-documentation'
import { readDocsPageSnapshot } from '../docs-page'
import type { SiteUrlConfig } from '../docs-corpus/manifest-store'
import {
  summarizeReadCurrentDocActivity,
  summarizeReadDocActivity,
  summarizeSearchDocsActivity
} from './activity'
import { captureDocsRunPin, resolveCurrentDocument, type DocsRunPin } from './current-document'
import { readDocument } from './read-document'
import {
  boundedMessage,
  boundedPathname,
  enforceResponseCap,
  RESPONSE_CHARACTER_CAP,
  serializedLength
} from './response-cap'
import {
  readCurrentDocInputSchema,
  readCurrentDocOutputSchema,
  readDocInputSchema,
  readDocOutputSchema,
  searchDocsInputSchema,
  searchDocsOutputSchema,
  type ReadCurrentDocInput,
  type ReadCurrentDocOutput,
  type ReadDocInput,
  type ReadDocOutput,
  type SearchDocsInput,
  type SearchDocsOutput
} from './schemas'

export const DOCUMENTATION_TOOL_GROUP_ID = 'documentation'

export const SEARCH_DOCS_TOOL_ID = 'search_docs'
export const READ_DOC_TOOL_ID = 'read_doc'
export const READ_CURRENT_DOC_TOOL_ID = 'read_current_doc'

export type DocumentationToolDependencies = {
  /**
   * The site's `baseUrl`/`trailingSlash`. Defaults to whatever #476 last
   * published, which is the only place inside Docusaurus' context.
   */
  getSiteConfig?: () => SiteUrlConfig | undefined
}

const DEFAULT_SITE_CONFIG: SiteUrlConfig = { baseUrl: '/', trailingSlash: undefined }

const resolveSiteConfig = (dependencies: DocumentationToolDependencies): SiteUrlConfig =>
  dependencies.getSiteConfig?.() ?? readDocsPageSnapshot()?.siteConfig ?? DEFAULT_SITE_CONFIG

/**
 * Search responses are far smaller than the cap in practice (ten results with
 * bounded snippets), but #477's limit is absolute, so results are dropped from
 * the end until the payload fits rather than left for the transport to cut.
 */
const fitSearchResults = (payload: SearchDocsOutput): SearchDocsOutput => {
  if (payload.status !== 'ok') return payload
  let results = payload.results
  let candidate = payload
  while (serializedLength(candidate) > RESPONSE_CHARACTER_CAP && results.length > 0) {
    results = results.slice(0, results.length - 1)
    candidate = { ...payload, results }
  }
  return candidate
}

/**
 * The one place every response in this group is checked against the cap.
 *
 * Each tool builds its result however it likes and then passes it through here.
 * That is what makes "no response exceeds the limit" a property of the boundary
 * rather than a habit each variant has to remember — the failure mode being
 * guarded against is a *new* variant (#478/#479 add more) carrying one
 * unbounded field, which is invisible until the transport cuts the JSON.
 */
const OVERSIZED_READ_MESSAGE =
  'this documentation page cannot be returned: its own metadata is larger than a single tool ' +
  'response may be. Use search_docs to find a more specific page, or read one section by anchor.'

/**
 * The search fallback. Unreachable in practice — the input schema bounds the
 * query and `fitSearchResults` can always drop to zero results — but the
 * postcondition is uniform across the group rather than argued case by case.
 */
const EMPTY_SEARCH_RESULT: SearchDocsOutput = { status: 'ok', query: '', results: [] }

const cappedRead = <T extends ReadDocOutput | ReadCurrentDocOutput>(payload: T): T =>
  enforceResponseCap(
    payload,
    () =>
      ({
        status: 'error',
        code: 'response_too_large',
        message: OVERSIZED_READ_MESSAGE,
        retryable: false
      }) as T
  )

const createSearchDocsTool = (
  dependencies: DocumentationToolDependencies
): Tool<SearchDocsInput, SearchDocsOutput> => ({
  id: SEARCH_DOCS_TOOL_ID,
  description:
    'Search the TinyTinkerer documentation and return matching pages with a canonical link and a ' +
    'snippet showing why each matched. Use this to find which page answers a question, then pass a ' +
    "result's `ref` to read_doc to read it. Returns unique pages, most relevant first.",
  schema: searchDocsInputSchema,
  outputSchema: searchDocsOutputSchema,
  summarizeActivity: summarizeSearchDocsActivity,
  async execute({ query, maxResults }) {
    const response = await searchDocumentation(resolveSiteConfig(dependencies), query, maxResults)
    if (!response.ok) {
      return enforceResponseCap<SearchDocsOutput>(
        {
          status: 'search_unavailable',
          code: response.code,
          // Upstream text this code did not choose the length of.
          message: boundedMessage(response.message),
          retryable: response.retryable
        },
        () => EMPTY_SEARCH_RESULT
      )
    }
    return enforceResponseCap(
      fitSearchResults({
        status: 'ok',
        query: response.query,
        // `section`/`anchor` are omitted rather than null — see schemas.ts.
        results: response.results.map((result) => ({
          ref: result.ref,
          title: result.title,
          permalink: result.permalink,
          ...(result.section === null ? {} : { section: result.section }),
          ...(result.anchor === null ? {} : { anchor: result.anchor }),
          snippet: result.snippet
        }))
      }),
      () => EMPTY_SEARCH_RESULT
    )
  }
})

const createReadDocTool = (
  dependencies: DocumentationToolDependencies
): Tool<ReadDocInput, ReadDocOutput> => ({
  id: READ_DOC_TOOL_ID,
  description:
    'Read a documentation page by its `ref` — the id a search_docs result carries. Optionally pass ' +
    'an `anchor` from the page outline to read one section. Without an anchor, a page too large to ' +
    'return in full comes back as a balanced overview of every section, each of which can then be ' +
    'read in full by anchor. This reads authored documentation only; it never fetches a URL.',
  schema: readDocInputSchema,
  outputSchema: readDocOutputSchema,
  summarizeActivity: summarizeReadDocActivity,
  async execute(input) {
    return cappedRead(
      await readDocument(resolveSiteConfig(dependencies), {
        ref: input.ref,
        ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
        ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars })
      })
    )
  }
})

/**
 * `read_current_doc`'s body, as a function of the route the run was pinned to
 * (issue #480 review, finding 5; re-review, findings 1 and 4).
 *
 * Separated from the tool's DEFINITION below because the pin is the one thing
 * about this tool that a run supplies and the catalogue cannot know. Everything
 * else — id, description, schemas, summarizer — is written once, in the tool, and
 * a run binding is structurally incapable of restating it.
 *
 * `pin` is undefined for a direct call and for the catalogue's own body, which
 * `resolveCurrentDocument` answers about the latest publication instead.
 */
const executeReadCurrentDoc = async (
  dependencies: DocumentationToolDependencies,
  pin: DocsRunPin | undefined,
  input: ReadCurrentDocInput
): Promise<ReadCurrentDocOutput> => {
  const current = await resolveCurrentDocument(pin)
  if (current.kind === 'not-on-doc-page') {
    return cappedRead({
      status: 'not_on_doc_page',
      // A route is caller-controlled in the same way a `ref` is.
      pathname: boundedPathname(current.pathname),
      message: boundedMessage(current.message)
    })
  }
  if (current.kind === 'unavailable') {
    return cappedRead({
      status: 'unavailable',
      pathname: boundedPathname(current.pathname),
      reason: current.reason,
      message: boundedMessage(current.message),
      retryable: current.retryable
    })
  }

  // Read by (ref, version), not by ref alone: a route belonging to a
  // non-canonical documentation version must read that version's content, not
  // whatever an unqualified lookup resolves to.
  return cappedRead(
    await readDocument(dependencies.getSiteConfig?.() ?? current.siteConfig, {
      ref: current.document.ref,
      version: current.document.version,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars })
    })
  )
}

const createReadCurrentDocTool = (
  dependencies: DocumentationToolDependencies
): Tool<ReadCurrentDocInput, ReadCurrentDocOutput> => ({
  id: READ_CURRENT_DOC_TOOL_ID,
  description:
    'Read the documentation page the reader is currently on. Use this for questions about "this ' +
    'page". Optionally pass an `anchor` to read one section. Reports explicitly when the current ' +
    'route has no documentation page (search results, a 404) so you never claim a current page ' +
    'that does not exist.',
  schema: readCurrentDocInputSchema,
  outputSchema: readCurrentDocOutputSchema,
  summarizeActivity: summarizeReadCurrentDocActivity,
  execute: (input) => executeReadCurrentDoc(dependencies, undefined, input)
})

/**
 * The `Documentation` group, ready to hand to
 * `createBrowserApp(config, { appToolGroup })`. #479 attaches it to the
 * assistant session; nothing else in the docs app should create a second one,
 * since a runtime registers tool ids uniquely.
 */
export const createDocumentationToolGroup = (
  dependencies: DocumentationToolDependencies = {}
): AppToolGroup => ({
  id: DOCUMENTATION_TOOL_GROUP_ID,
  label: 'Documentation',
  // ONE catalogue, built once. It is what the tool picker lists AND what the
  // runtime registers, so an id, a schema or a description cannot differ between
  // what the reader selects and what the model is handed — not because two lists
  // are validated against each other, but because there is only one list (issue
  // #480 re-review, finding 1).
  tools: [
    createSearchDocsTool(dependencies),
    createReadDocTool(dependencies),
    createReadCurrentDocTool(dependencies)
  ],
  // The one thing a RUN adds: the route the reader was on when they hit send, so
  // "which page is this?" is answered about that page rather than wherever they
  // have navigated to by the time the model gets around to calling the tool.
  //
  // `search_docs` and `read_doc` capture nothing and are therefore not bound at
  // all — they are served from the catalogue, as the same instances.
  bindRun: () => {
    const pin = captureDocsRunPin()
    return {
      [READ_CURRENT_DOC_TOOL_ID]: {
        execute: (input: ReadCurrentDocInput) => executeReadCurrentDoc(dependencies, pin, input)
      }
    }
  }
})
