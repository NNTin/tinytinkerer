import {
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
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

// Web-search presentation owned by the plugin, not the host. Maps the Tavily-shaped
// SearchResponse output (`{ query, results }`) to the host's product-agnostic
// ActivityView so the turn-activity panel can render it without knowing this plugin
// exists. Pure and React-free (enforced by scripts/check-boundaries.mjs): the host
// renders the returned `value`s as plain text. The short label 'Web search' lives
// here too (it is the view title), so the host no longer special-cases the tool id.
export const summarizeWebSearchActivity: ActivitySummarizer = (output): ActivityView => {
  const value = (output ?? {}) as { query?: unknown; results?: unknown }
  const resultCount = Array.isArray(value.results) ? value.results.length : 0
  const sections: ActivityView['sections'] = [
    { label: 'Results', value: String(resultCount) }
  ]
  if (typeof value.query === 'string' && value.query.length > 0) {
    sections.push({ label: 'Query', value: value.query })
  }
  return { title: 'Web search', sections }
}

// UI + planner metadata for the host. The shape is the generic PluginManifest
// contract from contracts; this plugin ships its own copy and tool descriptor.
// The descriptor mirrors the SearchRequest schema so the planner can name the
// tool without instantiating the plugin. `defaultEnabled` keeps web search on
// out-of-the-box; it appears in the generic plugin activation list like any
// other plugin and the user can turn it off there. `summarizeActivity` carries
// the plugin's own activity-panel presentation (see summarizeWebSearchActivity).
export const webSearchPluginManifest: PluginManifest = {
  id: WEB_SEARCH_PLUGIN_ID,
  label: 'Web search (Tavily)',
  description: 'Allow the agent to search the web for up-to-date information.',
  capabilities: ['tools'],
  defaultEnabled: true,
  toolDescriptors: [
    {
      id: WEB_SEARCH_PLUGIN_ID,
      description: 'Search the web for fresh context using Tavily.',
      inputSchema: {
        query: { type: 'string', description: 'Search query (2–500 chars)' },
        maxResults: { type: 'number', description: 'Max results (1–10, optional)' }
      },
      summarizeActivity: summarizeWebSearchActivity
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
        parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.code}`
        )
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
