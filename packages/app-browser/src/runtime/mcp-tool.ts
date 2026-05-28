import type { Tool } from '@tinytinkerer/app-core'
import {
  edgeErrorResponseSchema,
  mcpCallResponseSchema,
  type McpCallResponse,
  type McpServerConfig,
  type McpToolMeta
} from '@tinytinkerer/contracts'
import { z } from 'zod'
import type { EdgeFetch } from './edge-fetch'

export const createMcpTool = (
  server: McpServerConfig,
  toolMeta: McpToolMeta,
  edgeFetch: EdgeFetch
): Tool<Record<string, unknown>, McpCallResponse> => ({
  id: `mcp:${server.id}:${toolMeta.toolName}`,
  description: `[${server.name}] ${toolMeta.description}`,
  schema: z.record(z.string(), z.unknown()),
  async execute(input) {
    const response = await edgeFetch('/api/mcp/call', {
      url: server.url,
      bearerToken: server.bearerToken,
      toolName: toolMeta.toolName,
      arguments: input
    })

    if (!response.ok) {
      const payload = await response
        .clone()
        .json()
        .then((value) => edgeErrorResponseSchema.safeParse(value))
        .catch(() => undefined)

      throw new Error(
        payload?.success ? payload.data.error : `MCP call failed (${response.status})`
      )
    }

    return mcpCallResponseSchema.parse(await response.json())
  }
})
