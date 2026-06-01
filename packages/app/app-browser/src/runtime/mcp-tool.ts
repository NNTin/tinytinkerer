import type { Tool } from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  mcpCallResponseSchema,
  type McpCallResponse,
  type McpServerConfig,
  type McpToolMeta
} from '@tinytinkerer/contracts'
import { z } from 'zod'
import type { EdgeFetch } from './edge-fetch'
import { parseJsonWithTelemetry, parseWithTelemetry } from '../telemetry/request-telemetry'

export const createMcpTool = (
  server: McpServerConfig,
  toolMeta: McpToolMeta,
  edgeFetch: EdgeFetch
): Tool<Record<string, unknown>, McpCallResponse> => ({
  id: `mcp:${server.id}:${toolMeta.toolName}`,
  description: `[${server.name}] ${toolMeta.description}`,
  schema: z.record(z.string(), z.unknown()),
  async execute(input) {
    const response = await edgeFetch(EDGE_ROUTE_PATHS.mcpCall, {
      url: server.url,
      bearerToken: server.bearerToken,
      toolName: toolMeta.toolName,
      arguments: input
    }, { area: 'mcp.call' })
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
