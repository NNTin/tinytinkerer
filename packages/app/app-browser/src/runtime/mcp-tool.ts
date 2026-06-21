import type { ActivityView, Tool } from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  mcpCallResponseSchema,
  type McpCallResponse,
  type McpServerConfig,
  type McpToolMeta
} from '@tinytinkerer/contracts'
import type { EdgeFetch } from './edge-fetch'
import { mcpInputSchemaToZod } from './mcp-schema'
import { parseJsonWithTelemetry, parseWithTelemetry } from '../telemetry/request-telemetry'

// A contributed tool id of the form `mcp:<serverId>:<toolName>`. The MCP layer —
// not the activity panel — owns recognizing and summarizing its own output, so
// this pattern lives here next to the tool wiring.
const MCP_TOOL_ID_PATTERN = /^mcp:([^:]+):(.+)$/

export const isMcpToolId = (toolId: string): boolean => MCP_TOOL_ID_PATTERN.test(toolId)

// Maps an MCP tool's `{ text, isError }` output to the host's product-agnostic
// ActivityView. The `title` is host-resolved (the `[server] tool` label needs the
// user's server-name map, which lives outside this output) and threaded in by the
// resolver, so this stays a pure output→view mapper keyed by the `mcp:*` pattern.
// Tool output is untrusted; the host renders these values as text, never HTML.
export const summarizeMcpActivity = (title: string, output: unknown): ActivityView => {
  const value = (output ?? {}) as { text?: unknown; isError?: unknown }
  const text = typeof value.text === 'string' ? value.text : ''
  const isError = value.isError === true
  const sections: ActivityView['sections'] = text
    ? [{ kind: 'text', label: isError ? 'Error' : 'Output', value: text }]
    : []
  return { title, status: isError ? 'error' : 'ok', sections }
}

export const createMcpTool = (
  server: McpServerConfig,
  toolMeta: McpToolMeta,
  edgeFetch: EdgeFetch
): Tool<Record<string, unknown>, McpCallResponse> => ({
  id: `mcp:${server.id}:${toolMeta.toolName}`,
  description: `[${server.name}] ${toolMeta.description}`,
  // Validate the model's arguments against the tool's discovered JSON Schema before
  // the edge call, so a bad/hallucinated argument fails locally (where the agent can
  // correct it) rather than as an opaque remote error. Fail-open for schema shapes
  // the compiler can't model — see mcpInputSchemaToZod.
  schema: mcpInputSchemaToZod(toolMeta.inputSchema),
  async execute(input) {
    const response = await edgeFetch(
      EDGE_ROUTE_PATHS.mcpCall,
      {
        url: server.url,
        bearerToken: server.bearerToken,
        toolName: toolMeta.toolName,
        arguments: input
      },
      { area: 'mcp.call' }
    )
    const metadata = {
      area: 'mcp.call' as const,
      origin: 'edge' as const,
      method: 'POST',
      url: response.url
    }

    if (!response.ok) {
      const payload = await parseJsonWithTelemetry<unknown>(metadata, response.clone())
        .then((value) => edgeErrorResponseSchema.safeParse(value))
        .catch(() => undefined)

      throw new Error(
        payload?.success ? payload.data.error : `MCP call failed (${response.status})`
      )
    }

    const payload = await parseJsonWithTelemetry<unknown>(metadata, response)
    return parseWithTelemetry(
      metadata,
      'schema_error',
      'MCP call response did not match schema',
      () => mcpCallResponseSchema.parse(payload),
      response
    )
  }
})
