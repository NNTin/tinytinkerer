import type { McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'

export type SettingsState = {
  hydrated: boolean
  selectedModel: string
  searchEnabled: boolean
  showThinkingTimeline: boolean
  showToolActivity: boolean
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
  initialize: () => Promise<void>
  setSelectedModel: (model: string) => Promise<void>
  setSearchEnabled: (enabled: boolean) => Promise<void>
  setShowThinkingTimeline: (show: boolean) => Promise<void>
  setShowToolActivity: (show: boolean) => Promise<void>
  addMcpServer: (server: Omit<McpServerConfig, 'id'>) => Promise<McpServerConfig>
  updateMcpServer: (id: string, patch: Partial<Omit<McpServerConfig, 'id'>>) => Promise<void>
  removeMcpServer: (id: string) => Promise<void>
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>
  setMcpDiscovery: (result: McpDiscoveryResult) => Promise<void>
  clearMcpDiscovery: (serverId: string) => Promise<void>
}

export type SettingsStore = StoreApi<SettingsState>

const DEFAULT_MODEL = 'openai/gpt-4.1-mini'

const SETTINGS_KEYS = {
  selectedModel: 'settings_selected_model',
  searchEnabled: 'settings_search_enabled',
  showThinkingTimeline: 'settings_show_thinking_timeline',
  showToolActivity: 'settings_show_tool_activity',
  mcpServers: 'settings_mcp_servers',
  mcpDiscovery: 'settings_mcp_discovery'
} as const

const defaultSettingsState = (): Omit<SettingsState, 'initialize' | 'setSelectedModel' | 'setSearchEnabled' | 'setShowThinkingTimeline' | 'setShowToolActivity' | 'addMcpServer' | 'updateMcpServer' | 'removeMcpServer' | 'setMcpServerEnabled' | 'setMcpDiscovery' | 'clearMcpDiscovery'> => ({
  hydrated: false,
  selectedModel: DEFAULT_MODEL,
  searchEnabled: true,
  showThinkingTimeline: true,
  showToolActivity: true,
  mcpServers: [],
  mcpDiscovery: {}
})

export const createSettingsStore = (shell: BrowserShell): SettingsStore =>
  createStore<SettingsState>((set, get) => ({
    ...defaultSettingsState(),
    initialize: async () => {
      const { loadSettingsState } = await loadCoreModule()
      const state = await loadSettingsState(shell.preferences)
      set(state)
    },
    setSelectedModel: async (model) => {
      const { persistSelectedModel } = await loadCoreModule()
      const normalizedModel = await persistSelectedModel(shell.preferences, model)
      set({ selectedModel: normalizedModel })
    },
    setSearchEnabled: async (enabled) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.searchEnabled, enabled)
      set({ searchEnabled: enabled })
    },
    setShowThinkingTimeline: async (show) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.showThinkingTimeline, show)
      set({ showThinkingTimeline: show })
    },
    setShowToolActivity: async (show) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.showToolActivity, show)
      set({ showToolActivity: show })
    },
    addMcpServer: async (server) => {
      const { persistMcpServers } = await loadCoreModule()
      const newServer: McpServerConfig = { ...server, id: crypto.randomUUID() }
      const nextServers = [...get().mcpServers, newServer]
      await persistMcpServers(shell.preferences, nextServers)
      set({ mcpServers: nextServers })
      return newServer
    },
    updateMcpServer: async (id, patch) => {
      const { persistMcpDiscovery, persistMcpServers } = await loadCoreModule()
      const current = get()
      const nextServers = current.mcpServers.map((s) => (s.id === id ? { ...s, ...patch } : s))
      await persistMcpServers(shell.preferences, nextServers)
      const urlOrTokenChanged = 'url' in patch || 'bearerToken' in patch
      if (urlOrTokenChanged) {
        const nextDiscovery = { ...current.mcpDiscovery }
        delete nextDiscovery[id]
        await persistMcpDiscovery(shell.preferences, nextDiscovery)
        set({ mcpServers: nextServers, mcpDiscovery: nextDiscovery })
      } else {
        set({ mcpServers: nextServers })
      }
    },
    removeMcpServer: async (id) => {
      const { persistMcpDiscovery, persistMcpServers } = await loadCoreModule()
      const current = get()
      const nextServers = current.mcpServers.filter((s) => s.id !== id)
      const nextDiscovery = { ...current.mcpDiscovery }
      delete nextDiscovery[id]
      await Promise.all([
        persistMcpServers(shell.preferences, nextServers),
        persistMcpDiscovery(shell.preferences, nextDiscovery)
      ])
      set({ mcpServers: nextServers, mcpDiscovery: nextDiscovery })
    },
    setMcpServerEnabled: async (id, enabled) => {
      const { persistMcpServers } = await loadCoreModule()
      const nextServers = get().mcpServers.map((s) => (s.id === id ? { ...s, enabled } : s))
      await persistMcpServers(shell.preferences, nextServers)
      set({ mcpServers: nextServers })
    },
    setMcpDiscovery: async (result) => {
      const { persistMcpDiscovery } = await loadCoreModule()
      const nextDiscovery = { ...get().mcpDiscovery, [result.serverId]: result }
      await persistMcpDiscovery(shell.preferences, nextDiscovery)
      set({ mcpDiscovery: nextDiscovery })
    },
    clearMcpDiscovery: async (serverId) => {
      const { persistMcpDiscovery } = await loadCoreModule()
      const nextDiscovery = { ...get().mcpDiscovery }
      delete nextDiscovery[serverId]
      await persistMcpDiscovery(shell.preferences, nextDiscovery)
      set({ mcpDiscovery: nextDiscovery })
    }
  }))
