import {
  EDGE_ROUTE_PATHS,
  mcpDiscoveryResultSchema,
  type McpDiscoveryResult,
  type McpServerConfig
} from '@tinytinkerer/contracts'
import { createEdgeFetch } from './edge-fetch'
import { parseJsonWithTelemetry, parseWithTelemetry } from '../telemetry/request-telemetry'

/** What discovery needs to know about a server, user-added or host-provided. */
export type McpDiscoveryTarget = Pick<McpServerConfig, 'id' | 'name' | 'url' | 'bearerToken'>

/**
 * Runs `POST /api/mcp/discover` for one server and returns the result to store.
 *
 * Never throws: an HTTP failure, a schema mismatch and a network error all come
 * back as a result with `error` set and no tools, which is how a server that
 * failed its last sync is represented everywhere (it contributes no tools).
 *
 * Shared by the Settings refresh of a user's server and the boot-time discovery
 * of host-provided servers (issue #510, T2), so the two cannot drift. A
 * host-provided server passes no `bearerToken`; the edge injects its token.
 */
export const discoverMcpServer = async (
  edgeBaseUrl: string,
  token: string | null | undefined,
  server: McpDiscoveryTarget
): Promise<McpDiscoveryResult> => {
  const failed = (error: string): McpDiscoveryResult => ({
    serverId: server.id,
    serverName: server.name,
    tools: [],
    syncedAt: new Date().toISOString(),
    error
  })

  try {
    const edgeFetch = createEdgeFetch(edgeBaseUrl, () => token)
    const res = await edgeFetch(
      EDGE_ROUTE_PATHS.mcpDiscover,
      {
        url: server.url,
        bearerToken: server.bearerToken
      },
      { area: 'mcp.discover' }
    )
    const metadata = {
      area: 'mcp.discover' as const,
      origin: 'edge' as const,
      method: 'POST',
      url: res.url
    }
    if (!res.ok) {
      const errBody =
        (await parseJsonWithTelemetry<Record<string, unknown> | undefined>(
          metadata,
          res.clone()
        ).catch(() => undefined)) ?? {}
      return failed((errBody as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    const raw = await parseJsonWithTelemetry<unknown>(metadata, res)
    return parseWithTelemetry(
      metadata,
      'schema_error',
      'MCP discovery response did not match schema',
      () =>
        mcpDiscoveryResultSchema.parse({
          ...(raw as object),
          serverId: server.id
        }),
      res
    )
  } catch (e) {
    return failed(e instanceof Error ? e.message : 'Discovery failed')
  }
}
