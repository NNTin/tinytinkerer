import {
  EDGE_ROUTE_PATHS,
  boundedPreview,
  edgeErrorResponseSchema,
  KEYWORD_PROMPT_SENTINEL,
  PluginCaptureError,
  searchRequestSchema,
  searchResponseSchema,
  type ActivitySummarizer,
  type ActivityView,
  type AgentPlugin,
  type PluginHost,
  type PluginManifest,
  type PluginModule,
  type SearchRequest,
  type SearchResponse,
  type Tool
} from '@tinytinkerer/contracts'

// Stable id used as the activation key and the contributed tool id. It must stay
// 'web-search' for planning, the LiteLLM planner descriptor, and the turn
// activity panel to keep recognising the tool.
export const WEB_SEARCH_PLUGIN_ID = 'web-search'

// Most results the activity panel will render before collapsing the rest into a
// "… (N more)" note, and the longest snippet it inlines per result. The full result
// set still reaches the model — the panel only needs a readable preview, so these
// bounds keep a chatty response from flooding the timeline.
const MAX_RENDERED_RESULTS = 8
const MAX_SNIPPET_CHARS = 300

// One Tavily result rendered as a readable text section: the title is the label and
// the URL + snippet are the value. The panel renders text with `whitespace-pre-wrap`,
// so the URL and snippet read on their own lines.
const resultSection = (
  result: { title?: unknown; url?: unknown; snippet?: unknown },
  index: number
): ActivityView['sections'][number] => {
  const title =
    typeof result.title === 'string' && result.title.length > 0 ? result.title : '(untitled)'
  const url = typeof result.url === 'string' ? result.url : ''
  const snippet =
    typeof result.snippet === 'string' ? boundedPreview(result.snippet, MAX_SNIPPET_CHARS) : ''
  const value = [url, snippet].filter((part) => part.length > 0).join('\n')
  return { kind: 'text', label: `${index + 1}. ${title}`, value }
}

// Web-search presentation owned by the plugin, not the host. Maps the Tavily-shaped
// SearchResponse output (`{ query, results }`) to the host's product-agnostic
// ActivityView so the turn-activity panel can render it without knowing this plugin
// exists. Pure and React-free (enforced by scripts/check-boundaries.mjs): the host
// renders the returned `value`s as plain text. The short label 'Web search' lives
// here too (it is the view title), so the host no longer special-cases the tool id.
// The actual results (title/url/snippet) are surfaced so the timeline shows the
// information the model received, not just a count.
export const summarizeWebSearchActivity: ActivitySummarizer = (output): ActivityView => {
  const value = (output ?? {}) as { query?: unknown; results?: unknown }
  const results = Array.isArray(value.results) ? value.results : []
  const sections: ActivityView['sections'] = [
    { kind: 'text', label: 'Results', value: String(results.length) }
  ]
  if (typeof value.query === 'string' && value.query.length > 0) {
    sections.push({ kind: 'text', label: 'Query', value: value.query })
  }

  for (const [index, result] of results.slice(0, MAX_RENDERED_RESULTS).entries()) {
    sections.push(resultSection(result as Record<string, unknown>, index))
  }
  const overflow = results.length - MAX_RENDERED_RESULTS
  if (overflow > 0) {
    sections.push({
      kind: 'text',
      label: '',
      value: `… (${overflow} more result${overflow === 1 ? '' : 's'})`
    })
  }

  return { title: 'Web search', sections }
}

// Keywords that make the heuristic (no-LLM) fallback planner propose a web search.
// These used to be hard-coded in app-core's inferPlan; they now travel with the
// plugin so the host names no concrete tool id (see KeywordPlannerStep).
const WEB_SEARCH_KEYWORDS = ['latest', 'news', 'search', 'web', 'compare', 'today', 'research']

// UI + planner metadata for the host. The shape is the generic PluginManifest
// contract from contracts; this plugin ships its own copy and tool descriptor.
// The descriptor mirrors the SearchRequest schema so the planner can name the
// tool without instantiating the plugin. `defaultEnabled` keeps web search on
// out-of-the-box; it appears in the generic plugin activation list like any
// other plugin and the user can turn it off there. `summarizeActivity` carries
// the plugin's own activity-panel presentation (see summarizeWebSearchActivity);
// `keywordPlannerStep` carries the heuristic-fallback step the plugin owns.
export const webSearchPluginManifest: PluginManifest = {
  id: WEB_SEARCH_PLUGIN_ID,
  label: 'Web search (Tavily)',
  description: 'Allow the agent to search the web for up-to-date information.',
  defaultEnabled: true,
  starterPrompt: 'Research a topic for me.',
  toolDescriptors: [
    {
      id: WEB_SEARCH_PLUGIN_ID,
      description: 'Search the web for fresh context using Tavily.',
      // Canonical schema (issue #287): the SAME Zod schema the tool validates input
      // against (see createWebSearchTool). The host generates the planner-visible
      // JSON Schema from it, so the descriptor can never drift from the runtime
      // contract. Planner prose now lives on the schema's `.describe()` calls.
      schema: searchRequestSchema,
      summarizeActivity: summarizeWebSearchActivity,
      keywordPlannerStep: {
        keywords: WEB_SEARCH_KEYWORDS,
        stepId: 'search',
        summary: 'Collect current references from web search',
        inputTemplate: { query: KEYWORD_PROMPT_SENTINEL, maxResults: 5 }
      }
    }
  ]
}

// Thrown when the edge returns a 2xx body that does not match the canonical
// SearchResponse schema. This is the plugin's own validation failure (distinct
// from a transport/HTTP error, which the host already captures as request
// telemetry), so it carries a PluginReport: the registry routes that to the host
// capture sink (Sentry in the browser) and rethrows, so the runtime still sees a
// tool failure. Boundary-safe — it uses only contracts' PluginCaptureError, no
// telemetry SDK. `level: 'error'` makes it a captured exception, restoring the
// schema-error signal the in-app tool emitted before web search became a plugin.
export class WebSearchSchemaError extends PluginCaptureError {
  constructor(issues: string[]) {
    super(
      {
        pluginId: WEB_SEARCH_PLUGIN_ID,
        kind: 'schema_error',
        level: 'error',
        message: 'Search response did not match schema',
        // Only the validation issue paths/codes — never the response payload, so
        // no fetched content leaks into telemetry.
        contexts: { search: { issues } }
      },
      'Search response did not match schema'
    )
    this.name = 'WebSearchSchemaError'
  }
}

// Builds the web-search tool against the host's edge capability. The host owns
// the underlying request (and its request telemetry); this tool only shapes the
// request/response against the canonical contracts schemas. It stays
// product-agnostic — no browser APIs, no telemetry SDK, no app-browser imports.
const createWebSearchTool = (
  edgeFetch: PluginHost['edgeFetch']
): Tool<SearchRequest, SearchResponse> => ({
  id: WEB_SEARCH_PLUGIN_ID,
  description: 'Search the web for fresh context using Tavily.',
  schema: searchRequestSchema,
  // Output contract (issue #287): the runtime re-validates the result before the
  // inspector/timeline consume it. The tool already validates the edge body against
  // this schema internally; declaring it here makes that guarantee part of the Tool
  // contract the registry enforces, not just an internal check.
  outputSchema: searchResponseSchema,
  async execute(input) {
    if (!edgeFetch) {
      // Should never happen: the tool is only constructed when the host provides
      // an edge capability. Guard so the runtime sees a clean failure if it does.
      throw new Error('web-search: no edge backend available')
    }

    const response = await edgeFetch(EDGE_ROUTE_PATHS.search, input, { area: 'search' })

    if (!response.ok) {
      // Transport/HTTP failures are already captured as request telemetry by the
      // host edge layer (http_error), so surface a clean message without
      // double-capturing here.
      const payload = await response
        .json()
        .then((value) => edgeErrorResponseSchema.safeParse(value))
        .catch(() => undefined)

      throw new Error(payload?.success ? payload.data.error : `Search failed (${response.status})`)
    }

    const payload = await response.json()
    const parsed = searchResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new WebSearchSchemaError(
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      )
    }
    return parsed.data
  }
})

// The web-search plugin. Contributes a single web-search tool built against the
// host edge capability; needs no activate/deactivate lifecycle. A host without an
// edge backend simply gets no tool (the plugin tolerates the capability's
// absence rather than contributing a tool that cannot run).
export const webSearchPlugin = (): AgentPlugin => ({
  id: WEB_SEARCH_PLUGIN_ID,
  createTools: (host): Tool<unknown, unknown>[] =>
    host.edgeFetch ? [createWebSearchTool(host.edgeFetch)] : []
})

// PluginModule contract surface: the named exports a host discovers dynamically.
// `manifest` and `createPlugin` are the only members the host relies on.
export const manifest: PluginManifest = webSearchPluginManifest
export const createPlugin: PluginModule['createPlugin'] = webSearchPlugin
