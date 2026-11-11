import type { McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'

/**
 * An MCP server the embedding app provides to every user (issue #510, T2), e.g.
 * CanFactory's KiPrint. Passed to `createBrowserApp(config, { mcpServers })`.
 *
 * There is deliberately no token field. The edge injects the server's token for
 * hostnames listed in its `MCP_HOST_SERVERS`, from the `MCP_HOST_TOKENS` secret,
 * so the token never has to exist in the browser.
 */
export type HostMcpServer = {
  /** Stable id; tools register as `mcp:<id>:<tool>`. No `:`. */
  id: string
  name: string
  url: string
  /**
   * The app depends on this server (issue #518, F5). While its tools are
   * missing — discovery failed, is still running, or the user is signed out —
   * every turn's system prompt carries a one-line note saying the server is
   * unavailable, so the model tells the user instead of claiming to use a tool
   * it does not have. Omitted, a down server only shows in the UI.
   */
  required?: boolean
}

/**
 * The app's host-provided servers and their discovery results.
 *
 * Held in memory only. Unlike a user's servers, these are not written to the
 * user's preferences, and nothing in Settings can edit or remove them: they are
 * part of the app, re-read from its configuration on every boot.
 */
export type HostMcpState = {
  servers: readonly HostMcpServer[]
  discovery: Record<string, McpDiscoveryResult>
  /**
   * Server ids whose discovery is in flight. Every server starts here, until
   * the first `discover` call settles it.
   */
  syncing: readonly string[]
  /**
   * (Re)discovers every server with `token`. Called at boot and whenever the
   * sign-in token changes. Without a token it sends nothing and clears the
   * results: the edge's MCP routes require a signed-in caller, so the request
   * could only 401.
   */
  discover: (token: string | null) => Promise<void>
}

export type HostMcpStore = StoreApi<HostMcpState>

/**
 * Where one host server stands, for a host that renders its own status
 * (issue #518, F5). `unavailable` means its last discovery failed; `error` is
 * the reason. `signed-out` means discovery was never attempted, because the
 * edge's MCP routes need a signed-in caller.
 */
export type HostMcpServerStatus =
  | { state: 'syncing' }
  | { state: 'signed-out' }
  | { state: 'available'; toolCount: number }
  | { state: 'unavailable'; error: string }

export const hostMcpServerStatus = (
  state: Pick<HostMcpState, 'discovery' | 'syncing'>,
  serverId: string
): HostMcpServerStatus => {
  if (state.syncing.includes(serverId)) return { state: 'syncing' }
  const discovery = state.discovery[serverId]
  if (!discovery) return { state: 'signed-out' }
  if (discovery.error) return { state: 'unavailable', error: discovery.error }
  return { state: 'available', toolCount: discovery.tools.length }
}

/**
 * The one-line system note for `required` servers whose tools are missing from
 * this turn, or `undefined` when there are none. The discovery error is left
 * out on purpose: it is text from a remote server, and the model needs only to
 * know the tools are gone.
 */
export const hostMcpUnavailableNote = (
  state: Pick<HostMcpState, 'servers' | 'discovery'>
): string | undefined => {
  const missing = state.servers.filter((server) => {
    if (!server.required) return false
    const discovery = state.discovery[server.id]
    return !discovery || Boolean(discovery.error)
  })
  if (missing.length === 0) return undefined
  const names = missing.map((server) => server.name).join(', ')
  const verb = missing.length === 1 ? 'is' : 'are'
  return `Note: ${names} ${verb} unavailable right now, so ${missing.length === 1 ? 'its' : 'their'} tools are missing from this turn. If the user asks for something that needs ${missing.length === 1 ? 'it' : 'them'}, say it is unavailable; never claim to have used those tools.`
}

/** Stands in for an app that provides no servers, so a hook can always subscribe. */
export const EMPTY_HOST_MCP_STORE: HostMcpStore = createStore<HostMcpState>(() => ({
  servers: [],
  discovery: {},
  syncing: [],
  discover: () => Promise.resolve()
}))

/** The runtime's view of a host server: always enabled, never a token. */
export const hostMcpServerConfig = (server: HostMcpServer): McpServerConfig => ({
  id: server.id,
  name: server.name,
  url: server.url,
  enabled: true
})

const validateServers = (servers: readonly HostMcpServer[]): void => {
  const ids = new Set<string>()
  for (const server of servers) {
    // A misconfigured host server is a bug in the embedding app, so fail at
    // construction rather than drop the server's tools without a trace.
    if (!server.id || server.id.includes(':')) {
      throw new Error(`Host MCP server id "${server.id}" must be non-empty and contain no ":"`)
    }
    if (ids.has(server.id)) {
      throw new Error(`Host MCP server id "${server.id}" is used more than once`)
    }
    ids.add(server.id)
  }
}

export const createHostMcpStore = (
  shell: BrowserShell,
  servers: readonly HostMcpServer[]
): HostMcpStore => {
  validateServers(servers)
  // Only the latest discovery may write its results: signing out mid-sync, or
  // switching accounts, must not let the older run's results land last.
  let generation = 0

  return createStore<HostMcpState>((set) => ({
    servers,
    discovery: {},
    // Pending until the first `discover` (at boot) settles it, so a signed-in
    // user's servers read as syncing, never as signed out, before it runs.
    syncing: servers.map((server) => server.id),
    discover: async (token) => {
      generation += 1
      const current = generation
      if (!token) {
        set({ discovery: {}, syncing: [] })
        return
      }
      set({ syncing: servers.map((server) => server.id) })
      // Lazy, like every other edge call this module's callers make: the
      // store is built in every embedding app's startup entry.
      const { discoverMcpServer } = await import('../runtime/mcp-discovery')
      const results = await Promise.all(
        servers.map((server) => discoverMcpServer(shell.config.edgeBaseUrl, token, server))
      )
      if (current !== generation) return
      set({
        discovery: Object.fromEntries(results.map((result) => [result.serverId, result])),
        syncing: []
      })
    }
  }))
}
