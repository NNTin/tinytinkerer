import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { OpenAPIHono } from '@hono/zod-openapi'
import {
  edgeErrorResponseSchema,
  mcpCallResponseSchema,
  mcpDiscoveryResultSchema
} from '@tinytinkerer/contracts'
import type { Bindings } from '../lib/bindings'
import { mcpCallRoute, mcpDiscoverRoute } from '../openapi/routes'

// NOTE: This check covers only literal IP addresses and a set of well-known
// cloud-metadata hostnames. It cannot defend against a public-looking hostname
// that DNS-resolves to a private/RFC1918 address (DNS rebinding / SSRF via
// resolution). True protection requires either a pre-flight DNS lookup +
// connect-time IP check (unavailable in Cloudflare Workers without a
// third-party DNS-over-HTTPS call) or Cloudflare's built-in SSRF guardrails.
const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal', // GCP
  'instance-data', // GCP alternate
  'metadata.azure.internal', // Azure IMDS
  'metadata' // generic internal metadata alias
])

const isPrivateHostname = (hostname: string): boolean => {
  // Strip IPv6 brackets
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  // Well-known loopback/internal names and cloud metadata endpoints
  if (h === 'localhost' || METADATA_HOSTNAMES.has(h)) return true

  // IPv4 private ranges
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 127) return true // 127.0.0.0/8
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    if (a === 0) return true // 0.0.0.0/8
    if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
    return false
  }

  const isIpv6Literal = h.includes(':')
  if (isIpv6Literal) {
    // IPv6 private/reserved
    if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true
    if (h.startsWith('fc') || h.startsWith('fd')) return true // fc00::/7 ULA
    if (h.startsWith('fe80')) return true // link-local
  }

  return false
}

const validateMcpUrl = (raw: string): boolean => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false

  const hostname = url.hostname.replace(/^\[|\]$/g, '')

  // http is allowed only for localhost/127.0.0.1 (local dev)
  if (url.protocol === 'http:') {
    return hostname === 'localhost' || hostname === '127.0.0.1'
  }

  // https: block private/internal IP literals
  if (isPrivateHostname(hostname)) return false

  return true
}

const toMcpHeaders = (
  bearerToken: string | undefined
): Record<string, string> =>
  bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}

const makeTransport = (
  url: string,
  bearerToken: string | undefined
): Transport => {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: toMcpHeaders(bearerToken) }
  })
  return transport as unknown as Transport
}

export const registerMcpRoutes = (app: OpenAPIHono<{ Bindings: Bindings }>) => {
  app.openapi(mcpDiscoverRoute, async (c) => {
    const authorization =
      c.req.header('authorization') ?? c.req.header('Authorization')
    if (!authorization) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Unauthorized' }),
        401
      )
    }

    const { url, bearerToken } = c.req.valid('json')

    if (!validateMcpUrl(url)) {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'Invalid or disallowed MCP server URL'
        }),
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
        }),
        200
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'MCP discovery failed'
      return c.json(edgeErrorResponseSchema.parse({ error: message }), 502)
    } finally {
      await client.close().catch(() => undefined)
    }
  })

  app.openapi(mcpCallRoute, async (c) => {
    const authorization =
      c.req.header('authorization') ?? c.req.header('Authorization')
    if (!authorization) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Unauthorized' }),
        401
      )
    }

    const {
      url,
      bearerToken,
      toolName,
      arguments: toolArgs
    } = c.req.valid('json')

    if (!validateMcpUrl(url)) {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'Invalid or disallowed MCP server URL'
        }),
        400
      )
    }

    const client = new Client({ name: 'tinytinkerer-edge', version: '1.0.0' })
    const transport = makeTransport(url, bearerToken)

    try {
      await client.connect(transport)
      const serverVersion = client.getServerVersion()
      const serverName = serverVersion?.name ?? 'Unknown Server'

      const callResult = await client.callTool({
        name: toolName,
        arguments: toolArgs
      })

      const isError = callResult.isError === true
      const contentItems = Array.isArray(callResult.content)
        ? callResult.content
        : []
      const text = contentItems
        .filter((item): item is { type: 'text'; text: string } => {
          const candidate = item as Record<string, unknown>
          return candidate.type === 'text' && typeof candidate.text === 'string'
        })
        .map((item) => item.text)
        .join('\n')

      return c.json(
        mcpCallResponseSchema.parse({
          serverName,
          toolName,
          text,
          raw: callResult,
          isError
        }),
        200
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP call failed'
      return c.json(edgeErrorResponseSchema.parse({ error: message }), 502)
    } finally {
      await client.close().catch(() => undefined)
    }
  })
}
