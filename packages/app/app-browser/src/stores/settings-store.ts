import type { AgentType, McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'
import { setTelemetryConsent } from '../telemetry/telemetry'

export type SettingsState = {
  hydrated: boolean
  selectedModel: string
  agentType: AgentType
  searchEnabled: boolean
  webSpeechEnabled: boolean
  showReasoningActivity: boolean
  showCodeBlockFullscreenButton: boolean
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
  telemetryEnabled: boolean
  initialize: () => Promise<void>
  setSelectedModel: (model: string) => Promise<void>
  setAgentType: (agentType: AgentType) => Promise<void>
  setSearchEnabled: (enabled: boolean) => Promise<void>
  setWebSpeechEnabled: (enabled: boolean) => Promise<void>
  setShowReasoningActivity: (show: boolean) => Promise<void>
  setShowCodeBlockFullscreenButton: (show: boolean) => Promise<void>
  addMcpServer: (server: Omit<McpServerConfig, 'id'>) => Promise<McpServerConfig>
  updateMcpServer: (id: string, patch: Partial<Omit<McpServerConfig, 'id'>>) => Promise<void>
  removeMcpServer: (id: string) => Promise<void>
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>
  setMcpDiscovery: (result: McpDiscoveryResult) => Promise<void>
  clearMcpDiscovery: (serverId: string) => Promise<void>
  setTelemetryEnabled: (enabled: boolean) => Promise<void>
}

export type SettingsStore = StoreApi<SettingsState>

const DEFAULT_MODEL = 'openai/gpt-5'
const DEFAULT_AGENT_TYPE: AgentType = 'react'

const SETTINGS_KEYS = {
  selectedModel: 'settings_selected_model',
  agentType: 'settings_agent_type',
  searchEnabled: 'settings_search_enabled',
  webSpeechEnabled: 'settings_web_speech_enabled',
  showReasoningActivity: 'settings_show_reasoning_activity',
  showCodeBlockFullscreenButton: 'settings_show_code_block_fullscreen_button',
  mcpServers: 'settings_mcp_servers',
  mcpDiscovery: 'settings_mcp_discovery',
  telemetryEnabled: 'settings_telemetry_enabled'
} as const

const defaultSettingsState = (): Omit<SettingsState, 'initialize' | 'setSelectedModel' | 'setAgentType' | 'setSearchEnabled' | 'setWebSpeechEnabled' | 'setShowReasoningActivity' | 'setShowCodeBlockFullscreenButton' | 'addMcpServer' | 'updateMcpServer' | 'removeMcpServer' | 'setMcpServerEnabled' | 'setMcpDiscovery' | 'clearMcpDiscovery' | 'setTelemetryEnabled'> => ({
  hydrated: false,
  selectedModel: DEFAULT_MODEL,
  agentType: DEFAULT_AGENT_TYPE,
  searchEnabled: true,
  webSpeechEnabled: false,
  showReasoningActivity: false,
  showCodeBlockFullscreenButton: true,
  mcpServers: [],
  mcpDiscovery: {},
  telemetryEnabled: false
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
    setAgentType: async (agentType) => {
      const { persistAgentType } = await loadCoreModule()
      const normalized = await persistAgentType(shell.preferences, agentType)
      set({ agentType: normalized })
    },
    setSearchEnabled: async (enabled) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.searchEnabled, enabled)
      set({ searchEnabled: enabled })
    },
    setWebSpeechEnabled: async (enabled) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.webSpeechEnabled, enabled)
      set({ webSpeechEnabled: enabled })
    },
    setShowReasoningActivity: async (show) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.showReasoningActivity, show)
      set({ showReasoningActivity: show })
    },
    setShowCodeBlockFullscreenButton: async (show) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(
        shell.preferences,
        SETTINGS_KEYS.showCodeBlockFullscreenButton,
        show
      )
      set({ showCodeBlockFullscreenButton: show })
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
    },
    setTelemetryEnabled: async (enabled) => {
      const { persistBooleanPreference } = await loadCoreModule()
      await persistBooleanPreference(shell.preferences, SETTINGS_KEYS.telemetryEnabled, enabled)
      set({ telemetryEnabled: enabled })
      await setTelemetryConsent(enabled)
    }
  }))
