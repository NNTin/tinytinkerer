/**
 * The three documentation tools and the `Documentation` app tool group that
 * carries them (#477).
 *
 * They travel to the runtime as an `AppToolGroup` — the same mechanism
 * `apps/canvas` and `apps/mermaid` use for their stage verbs, and the same one
 * the docs tool-picker lab uses — rather than as a plugin, because `apps/docs`
 * can neither statically import a concrete `@tinytinkerer/plugin-*` package
 * (scripts/check-boundaries.mjs forbids it) nor discover one dynamically
 * (`import.meta.glob` has no webpack equivalent; see
 * live-lab/plugin-registry-stub.ts). An app group has no activation toggle,
 * which is the right shape here anyway: the documentation tools are intrinsic to
 * the documentation assistant. Individual tools remain independently
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
import { resolveCurrentDocument } from './current-document'
import { readDocument } from './read-document'
import { boundedMessage, RESPONSE_CHARACTER_CAP, serializedLength } from './response-cap'
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
      return {
        status: 'search_unavailable',
        code: response.code,
        // Upstream text this code did not choose the length of.
        message: boundedMessage(response.message),
        retryable: response.retryable
      }
    }
    return fitSearchResults({
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
    })
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
  execute(input) {
    return readDocument(resolveSiteConfig(dependencies), {
      ref: input.ref,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars })
    })
  }
})

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
  async execute(input) {
    const current = await resolveCurrentDocument()
    if (current.kind === 'not-on-doc-page') {
      return {
        status: 'not_on_doc_page',
        pathname: current.pathname,
        message: boundedMessage(current.message)
      }
    }
    if (current.kind === 'unavailable') {
      return {
        status: 'unavailable',
        pathname: current.pathname,
        reason: current.reason,
        message: boundedMessage(current.message),
        retryable: current.retryable
      }
    }

    // Read by (ref, version), not by ref alone: a route belonging to a
    // non-canonical documentation version must read that version's content, not
    // whatever an unqualified lookup resolves to.
    return readDocument(dependencies.getSiteConfig?.() ?? current.snapshot.siteConfig, {
      ref: current.document.ref,
      version: current.document.version,
      ...(input.anchor === undefined ? {} : { anchor: input.anchor }),
      ...(input.maxChars === undefined ? {} : { maxChars: input.maxChars })
    })
  }
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
  tools: [
    createSearchDocsTool(dependencies),
    createReadDocTool(dependencies),
    createReadCurrentDocTool(dependencies)
  ]
})
