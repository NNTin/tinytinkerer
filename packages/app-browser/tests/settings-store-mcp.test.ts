import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreferencesStore } from '@tinytinkerer/app-core'
import type { McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import { createSettingsStore } from '../src/stores/settings-store.js'
import type { BrowserShell } from '../src/shell.js'

const makePreferences = (): PreferencesStore & { store: Map<string, string> } => {
  const store = new Map<string, string>()
  return {
    store,
    get: (key: string) => Promise.resolve(store.get(key)),
    set: (key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve()
    }
  }
}

const makeShell = (preferences: PreferencesStore): BrowserShell =>
  ({
    config: {
      edgeBaseUrl: 'http://edge.local',
      storageNamespace: 'test',
      authMode: 'hybrid',
      githubClientId: 'test-client',
      hostToken: null
    },
    preferences,
    conversations: {},
    authTokens: {},
    statusGateway: {}
  }) as unknown as BrowserShell

const baseServer: Omit<McpServerConfig, 'id'> = {
  name: 'Weather Server',
  url: 'https://mcp.example.com/mcp',
  enabled: true
}

const makeDiscovery = (serverId: string): McpDiscoveryResult => ({
  serverId,
  serverName: 'Weather Server',
  tools: [{ toolName: 'get_weather', description: 'Get weather', inputSchema: {} }],
  syncedAt: new Date().toISOString()
})

let preferences: ReturnType<typeof makePreferences>

beforeEach(() => {
  preferences = makePreferences()
  vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('id-1').mockReturnValueOnce('id-2') })
})

describe('settings-store MCP actions', () => {
  describe('addMcpServer', () => {
    it('assigns a unique ID and persists the new server', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)

      expect(added.id).toBe('id-1')
      expect(store.getState().mcpServers).toHaveLength(1)
      expect(store.getState().mcpServers[0]).toMatchObject({ ...baseServer, id: 'id-1' })
    })

    it('generates distinct IDs for multiple servers', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const first = await store.getState().addMcpServer(baseServer)
      const second = await store.getState().addMcpServer({ ...baseServer, name: 'Other' })

      expect(first.id).not.toBe(second.id)
      expect(store.getState().mcpServers).toHaveLength(2)
    })

    it('writes the server list to preferences', async () => {
      const store = createSettingsStore(makeShell(preferences))
      await store.getState().addMcpServer(baseServer)

      const raw = await preferences.get('settings_mcp_servers')
      expect(raw).toBeDefined()
      const parsed = JSON.parse(raw!) as McpServerConfig[]
      expect(parsed).toHaveLength(1)
      expect(parsed[0]?.name).toBe('Weather Server')
    })
  })

  describe('updateMcpServer', () => {
    it('clears cached discovery when the URL changes', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      await store.getState().setMcpDiscovery(makeDiscovery(added.id))
      expect(store.getState().mcpDiscovery[added.id]).toBeDefined()

      await store.getState().updateMcpServer(added.id, { url: 'https://other.example.com/mcp' })

      expect(store.getState().mcpDiscovery[added.id]).toBeUndefined()
    })

    it('clears cached discovery when the bearer token changes', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      await store.getState().setMcpDiscovery(makeDiscovery(added.id))

      await store.getState().updateMcpServer(added.id, { bearerToken: 'new-secret' })

      expect(store.getState().mcpDiscovery[added.id]).toBeUndefined()
    })

    it('does NOT clear cached discovery when only the name changes', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      await store.getState().setMcpDiscovery(makeDiscovery(added.id))

      await store.getState().updateMcpServer(added.id, { name: 'Renamed Server' })

      expect(store.getState().mcpDiscovery[added.id]).toBeDefined()
      expect(store.getState().mcpServers[0]?.name).toBe('Renamed Server')
    })

    it('does NOT clear cached discovery when only enabled changes', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      await store.getState().setMcpDiscovery(makeDiscovery(added.id))

      await store.getState().updateMcpServer(added.id, { enabled: false })

      expect(store.getState().mcpDiscovery[added.id]).toBeDefined()
    })
  })

  describe('removeMcpServer', () => {
    it('removes the server from the list', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      await store.getState().removeMcpServer(added.id)

      expect(store.getState().mcpServers).toHaveLength(0)
    })

    it('also removes the associated discovery result', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      await store.getState().setMcpDiscovery(makeDiscovery(added.id))
      expect(store.getState().mcpDiscovery[added.id]).toBeDefined()

      await store.getState().removeMcpServer(added.id)

      expect(store.getState().mcpDiscovery[added.id]).toBeUndefined()
    })

    it('persists both config and discovery changes to preferences', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      await store.getState().setMcpDiscovery(makeDiscovery(added.id))

      await store.getState().removeMcpServer(added.id)

      const rawServers = await preferences.get('settings_mcp_servers')
      const rawDiscovery = await preferences.get('settings_mcp_discovery')
      expect(JSON.parse(rawServers ?? '[]')).toHaveLength(0)
      expect(Object.keys(JSON.parse(rawDiscovery ?? '{}'))).toHaveLength(0)
    })
  })

  describe('setMcpDiscovery', () => {
    it('stores the discovery result keyed by serverId', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)
      const discovery = makeDiscovery(added.id)

      await store.getState().setMcpDiscovery(discovery)

      expect(store.getState().mcpDiscovery[added.id]).toMatchObject({
        serverName: 'Weather Server',
        tools: [expect.objectContaining({ toolName: 'get_weather' })]
      })
    })

    it('writes the discovery map to preferences', async () => {
      const store = createSettingsStore(makeShell(preferences))
      const added = await store.getState().addMcpServer(baseServer)

      await store.getState().setMcpDiscovery(makeDiscovery(added.id))

      const raw = await preferences.get('settings_mcp_discovery')
      expect(raw).toBeDefined()
      const parsed = JSON.parse(raw!) as Record<string, McpDiscoveryResult>
      expect(parsed[added.id]?.serverName).toBe('Weather Server')
    })

    it('merges with existing discovery entries instead of replacing them', async () => {
      vi.mocked(crypto.randomUUID).mockReturnValueOnce('id-a' as `${string}-${string}-${string}-${string}-${string}`).mockReturnValueOnce('id-b' as `${string}-${string}-${string}-${string}-${string}`)
      const store = createSettingsStore(makeShell(preferences))
      const a = await store.getState().addMcpServer(baseServer)
      const b = await store.getState().addMcpServer({ ...baseServer, name: 'B' })

      await store.getState().setMcpDiscovery(makeDiscovery(a.id))
      await store.getState().setMcpDiscovery(makeDiscovery(b.id))

      expect(store.getState().mcpDiscovery[a.id]).toBeDefined()
      expect(store.getState().mcpDiscovery[b.id]).toBeDefined()
    })
  })
})
