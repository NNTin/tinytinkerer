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
import { callerValidationErrorResponse, validateLiteLLMCaller } from '../lib/caller-validation'
import { mcpCallRoute, mcpDiscoverRoute } from '../openapi/routes'

// NOTE: This check covers only literal IP addresses and a set of well-known
// cloud-metadata hostnames. It cannot defend against a public-looking hostname
// that DNS-resolves to a private/RFC1918 address (DNS rebinding / SSRF via
// resolution). True protection requires either a pre-flight DNS lookup +
// connect-time IP check (unavailable in Cloudflare Workers without a
// third-party DNS-over-HTTPS call) or Cloudflare's built-in SSRF guardrails.
// Deployments that need rebinding-proof behaviour should set MCP_ALLOWED_HOSTS
// (see parseHostnameList below), which replaces this blocklist with a strict
// host allowlist.
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

/**
 * Parse a hostname-list binding (MCP_ALLOWED_HOSTS, MCP_HOST_SERVERS):
 * comma-separated hostnames (no scheme, no port), case-insensitive. An
 * unset/empty binding yields an empty set. For MCP_ALLOWED_HOSTS that means
 * "allowlist not configured" — the static private-address blocklist applies
 * instead (see {@link validateMcpUrl}).
 */
const parseHostnameList = (raw: string | undefined): Set<string> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((host) =>
        host
          .trim()
          .toLowerCase()
          .replace(/^\[|\]$/g, '')
      )
      .filter(Boolean)
  )

/**
 * Parse the MCP_HOST_TOKENS secret: a JSON object mapping hostname → bearer
 * token, e.g. `{"kiprint.nntin.xyz":"<token>"}`. Keys are matched
 * case-insensitively. Entries whose value is not a non-empty string are
 * ignored. A malformed secret is logged (without its contents) and injects
 * nothing. The calls then reach the host server unauthenticated and fail
 * there, rather than taking down every MCP route.
 */
const parseMcpHostTokens = (raw: string | undefined): Map<string, string> => {
  const tokens = new Map<string, string>()
  if (!raw?.trim()) return tokens
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error('[mcp] MCP_HOST_TOKENS is not a JSON object; no host tokens are injected')
    return tokens
  }
  for (const [host, token] of Object.entries(parsed)) {
    if (typeof token === 'string' && token.length > 0) {
      tokens.set(host.trim().toLowerCase(), token)
    }
  }
  return tokens
}

// The scheme rules shared by every MCP URL, host-provided or not: http(s)
// only, and plain http only for localhost/127.0.0.1 (local dev). Returns the
// bracket-stripped, lower-cased hostname, or null when the URL is unusable.
const mcpUrlHostname = (raw: string): string | null => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (url.protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return null
  }

  return hostname
}

const validateMcpUrl = (raw: string, allowedHosts: Set<string>): boolean => {
  const hostname = mcpUrlHostname(raw)
  if (hostname === null) return false
  const isHttp = new URL(raw).protocol === 'http:'

  // A configured allowlist is authoritative: ONLY listed hosts pass (including
  // localhost — list it explicitly if local dev must work under an allowlist).
  // Unlike the blocklist below, this is not bypassable via DNS rebinding: the
  // operator names the trusted hosts instead of us guessing which resolve
  // privately.
  if (allowedHosts.size > 0) return allowedHosts.has(hostname)

  if (isHttp) return true

  // https with no allowlist configured: block private/internal IP literals
  if (isPrivateHostname(hostname)) return false

  return true
}

type McpTarget = { ok: true; bearerToken: string | undefined } | { ok: false }

/**
 * Decide whether the proxy may connect to `url`, and with which bearer token.
 *
 * A **host server** — its hostname is listed in MCP_HOST_SERVERS, issue #510
 * T2 — is an MCP server an embedding app (e.g. CanFactory's KiPrint) provides
 * to every user:
 *
 * - it is always reachable, even when MCP_ALLOWED_HOSTS is set, so trusting it
 *   never requires an exclusive allowlist that would block every user's own
 *   servers;
 * - its token comes ONLY from MCP_HOST_TOKENS. Whatever `bearerToken` the
 *   browser sent is dropped, so a host token never has to exist in the browser,
 *   and a caller cannot swap in its own. Unlisted hosts are never injected.
 *
 * Every other URL keeps today's behaviour: the MCP_ALLOWED_HOSTS allowlist or
 * the private-address blocklist, and the caller's own `bearerToken`.
 */
const resolveMcpTarget = (
  env: Bindings,
  url: string,
  callerBearerToken: string | undefined
): McpTarget => {
  const hostname = mcpUrlHostname(url)
  if (hostname === null) return { ok: false }

  if (parseHostnameList(env.MCP_HOST_SERVERS).has(hostname)) {
    return { ok: true, bearerToken: parseMcpHostTokens(env.MCP_HOST_TOKENS).get(hostname) }
  }

  return validateMcpUrl(url, parseHostnameList(env.MCP_ALLOWED_HOSTS))
    ? { ok: true, bearerToken: callerBearerToken }
    : { ok: false }
}

const toMcpHeaders = (bearerToken: string | undefined): Record<string, string> =>
  bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}

const makeTransport = (url: string, bearerToken: string | undefined): Transport =>
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: toMcpHeaders(bearerToken) }
  })

export const registerMcpRoutes = (app: OpenAPIHono<{ Bindings: Bindings }>) => {
  app.openapi(mcpDiscoverRoute, async (c) => {
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }

    // The MCP proxy makes an outbound request on the caller's behalf, so a
    // present-but-unverified Authorization header must not be enough to drive
    // it (otherwise the edge is an open SSRF proxy). Validate the caller's
    // GitHub identity before connecting, mirroring the models routes.
    const callerValidation = await validateLiteLLMCaller(authorization, c.env)
    if (callerValidation.status !== 'valid') {
      return callerValidationErrorResponse(c, callerValidation.status)
    }

    const { url, bearerToken } = c.req.valid('json')

    const target = resolveMcpTarget(c.env, url, bearerToken)
    if (!target.ok) {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'Invalid or disallowed MCP server URL'
        }),
        400
      )
    }

    const client = new Client({ name: 'tinytinkerer-edge', version: '1.0.0' })
    // A fresh transport per request: the proxy is stateless, so a server must
    // not rely on an `Mcp-Session-Id` surviving between discover and call.
    const transport = makeTransport(url, target.bearerToken)

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
      // Don't reflect the raw transport/SDK error to the client: it can leak
      // internal hostnames, IPs, or connection detail. Log it server-side and
      // return a generic message (security review LOW-1).
      console.error('[mcp/discover] connection error', error)
      return c.json(edgeErrorResponseSchema.parse({ error: 'MCP discovery failed' }), 502)
    } finally {
      await client.close().catch(() => undefined)
    }
  })

  app.openapi(mcpCallRoute, async (c) => {
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')
    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }

    // Validate the caller's GitHub identity before making any outbound MCP
    // request: a present-but-unverified Authorization header must not turn the
    // edge into an open SSRF proxy (mirrors the models routes).
    const callerValidation = await validateLiteLLMCaller(authorization, c.env)
    if (callerValidation.status !== 'valid') {
      return callerValidationErrorResponse(c, callerValidation.status)
    }

    const { url, bearerToken, toolName, arguments: toolArgs } = c.req.valid('json')

    const target = resolveMcpTarget(c.env, url, bearerToken)
    if (!target.ok) {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'Invalid or disallowed MCP server URL'
        }),
        400
      )
    }

    const client = new Client({ name: 'tinytinkerer-edge', version: '1.0.0' })
    // A fresh transport per request: the proxy is stateless, so a server must
    // not rely on an `Mcp-Session-Id` surviving between discover and call.
    const transport = makeTransport(url, target.bearerToken)

    try {
      await client.connect(transport)
      const serverVersion = client.getServerVersion()
      const serverName = serverVersion?.name ?? 'Unknown Server'

      const callResult = await client.callTool({
        name: toolName,
        arguments: toolArgs
      })

      const isError = callResult.isError === true
      const contentItems = Array.isArray(callResult.content) ? callResult.content : []
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
      // Generic message only — see the discover handler (security review LOW-1).
      console.error('[mcp/call] connection error', error)
      return c.json(edgeErrorResponseSchema.parse({ error: 'MCP call failed' }), 502)
    } finally {
      await client.close().catch(() => undefined)
    }
  })
}
