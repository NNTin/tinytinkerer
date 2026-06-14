import {
  type AgentPlugin,
  type PluginHost,
  type PluginManifest,
  type PluginModule,
  type Tool
} from '@tinytinkerer/agent-core'
import {
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
  type SearchRequest,
  type SearchResponse
} from '@tinytinkerer/contracts'

// Stable id used as the activation key and the contributed tool id. The host
// gates this plugin through its existing "search" readiness machinery, so the id
// must stay 'web-search' for planning, the LiteLLM planner descriptor, and the
// turn activity panel to keep recognising the tool.
export const WEB_SEARCH_PLUGIN_ID = 'web-search'

// UI + planner metadata for the host. The shape is the generic PluginManifest
// contract from agent-core; this plugin ships its own copy and tool descriptor.
// The descriptor mirrors the SearchRequest schema so the planner can name the
// tool without instantiating the plugin.
export const webSearchPluginManifest: PluginManifest = {
  id: WEB_SEARCH_PLUGIN_ID,
  label: 'Web search (Tavily)',
  description:
    'Let the assistant search the web for up-to-date information through Tavily. ' +
    'Enabled by default; the host surfaces its own readiness state and toggle.',
  capabilities: ['tools'],
  toolDescriptors: [
    {
      id: WEB_SEARCH_PLUGIN_ID,
      description: 'Search the web for fresh context using Tavily.',
      inputSchema: {
        query: { type: 'string', description: 'Search query (2–500 chars)' },
        maxResults: { type: 'number', description: 'Max results (1–10, optional)' }
      }
    }
  ]
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
      const payload = await response
        .json()
        .then((value) => edgeErrorResponseSchema.safeParse(value))
        .catch(() => undefined)

      throw new Error(payload?.success ? payload.data.error : `Search failed (${response.status})`)
    }

    const payload = await response.json()
    return searchResponseSchema.parse(payload)
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
