import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { zValidator } from '@hono/zod-validator'
import {
  edgeErrorResponseSchema,
  mcpCallRequestSchema,
  mcpCallResponseSchema,
  mcpDiscoverRequestSchema,
  mcpDiscoveryResultSchema
} from '@tinytinkerer/contracts'
import type { Hono } from 'hono'
import type { Bindings } from '../lib/bindings'

const validateMcpUrl = (raw: string): boolean => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol === 'http:') {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  }
  return false
}

const toMcpHeaders = (bearerToken: string | undefined): Record<string, string> =>
  bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}

const makeTransport = (url: string, bearerToken: string | undefined): Transport => {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: toMcpHeaders(bearerToken) }
  })
  return transport as unknown as Transport
}

export const registerMcpRoutes = (app: Hono<{ Bindings: Bindings }>) => {
  app.post('/api/mcp/discover', zValidator('json', mcpDiscoverRequestSchema), async (c) => {
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }

    const { url, bearerToken } = c.req.valid('json')

    if (!validateMcpUrl(url)) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Invalid or disallowed MCP server URL' }),
        400
      )
    }

    const client = new Client({ name: 'tinytinkerer-edge', version: '1.0.0' })
    const transport = makeTransport(url, bearerToken)

    try {
      await client.connect(transport)

      const serverVersion = client.getServerVersion()
      const serverName = serverVersion?.name ?? 'Unknown Server'

      const listResult = await client.listTools()
      const tools = (listResult.tools ?? []).map((t) => ({
        toolName: t.name,
        description: t.description ?? '',
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {}
      }))

      return c.json(
        mcpDiscoveryResultSchema.parse({
          serverId: '',
          serverName,
          tools,
          syncedAt: new Date().toISOString()
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP discovery failed'
      return c.json(edgeErrorResponseSchema.parse({ error: message }), 502)
    } finally {
      await client.close().catch(() => undefined)
    }
  })

  app.post('/api/mcp/call', zValidator('json', mcpCallRequestSchema), async (c) => {
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }

    const { url, bearerToken, toolName, arguments: toolArgs } = c.req.valid('json')

    if (!validateMcpUrl(url)) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Invalid or disallowed MCP server URL' }),
        400
      )
    }

    const client = new Client({ name: 'tinytinkerer-edge', version: '1.0.0' })
    const transport = makeTransport(url, bearerToken)

    try {
      await client.connect(transport)
      const serverVersion = client.getServerVersion()
      const serverName = serverVersion?.name ?? 'Unknown Server'

      const callResult = await client.callTool({ name: toolName, arguments: toolArgs })

      const isError = callResult.isError === true
      const contentItems = Array.isArray(callResult.content) ? callResult.content : []
      const text = contentItems
        .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
        .map((item) => item.text)
        .join('\n')

      return c.json(
        mcpCallResponseSchema.parse({
          serverName,
          toolName,
          text,
          raw: callResult,
          isError
        })
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP call failed'
      return c.json(edgeErrorResponseSchema.parse({ error: message }), 502)
    } finally {
      await client.close().catch(() => undefined)
    }
  })
}
