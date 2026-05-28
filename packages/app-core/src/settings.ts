import { DEFAULT_MODEL, normalizeSelectedModel } from './models'
import type { PreferencesStore } from './ports'
import {
  mcpDiscoveryResultSchema,
  mcpServerConfigSchema,
  type McpDiscoveryResult,
  type McpServerConfig
} from '@tinytinkerer/contracts'

export const SETTINGS_KEYS = {
  selectedModel: 'settings_selected_model',
  searchEnabled: 'settings_search_enabled',
  showThinkingTimeline: 'settings_show_thinking_timeline',
  showToolActivity: 'settings_show_tool_activity',
  showCodeBlockFullscreenButton: 'settings_show_code_block_fullscreen_button',
  mcpServers: 'settings_mcp_servers',
  mcpDiscovery: 'settings_mcp_discovery'
} as const

export type SettingsState = {
  hydrated: boolean
  selectedModel: string
  searchEnabled: boolean
  showThinkingTimeline: boolean
  showToolActivity: boolean
  showCodeBlockFullscreenButton: boolean
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
}

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export const defaultSettingsState = (): SettingsState => ({
  hydrated: false,
  selectedModel: DEFAULT_MODEL,
  searchEnabled: true,
  showThinkingTimeline: true,
  showToolActivity: true,
  showCodeBlockFullscreenButton: true,
  mcpServers: [],
  mcpDiscovery: {}
})

export const loadSettingsState = async (preferences: PreferencesStore): Promise<SettingsState> => {
  const [
    selectedModel,
    searchEnabled,
    showThinkingTimeline,
    showToolActivity,
    showCodeBlockFullscreenButton,
    mcpServersRaw,
    mcpDiscoveryRaw
  ] = await Promise.all([
    preferences.get(SETTINGS_KEYS.selectedModel),
    preferences.get(SETTINGS_KEYS.searchEnabled),
    preferences.get(SETTINGS_KEYS.showThinkingTimeline),
    preferences.get(SETTINGS_KEYS.showToolActivity),
    preferences.get(SETTINGS_KEYS.showCodeBlockFullscreenButton),
    preferences.get(SETTINGS_KEYS.mcpServers),
    preferences.get(SETTINGS_KEYS.mcpDiscovery)
  ])

  return {
    hydrated: true,
    selectedModel: normalizeSelectedModel(selectedModel),
    searchEnabled: parseBool(searchEnabled, true),
    showThinkingTimeline: parseBool(showThinkingTimeline, true),
    showToolActivity: parseBool(showToolActivity, true),
    showCodeBlockFullscreenButton: parseBool(showCodeBlockFullscreenButton, true),
    mcpServers: parseMcpServers(mcpServersRaw),
    mcpDiscovery: parseMcpDiscovery(mcpDiscoveryRaw)
  }
}

const parseMcpServers = (raw: string | undefined): McpServerConfig[] => {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      const result = mcpServerConfigSchema.safeParse(entry)
      return result.success ? [result.data] : []
    })
  } catch {
    return []
  }
}

const parseMcpDiscovery = (raw: string | undefined): Record<string, McpDiscoveryResult> => {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([serverId, entry]) => {
        const result = mcpDiscoveryResultSchema.safeParse(entry)
        return result.success ? [[serverId, result.data]] : []
      })
    )
  } catch {
    return {}
  }
}

export const persistMcpServers = async (
  preferences: PreferencesStore,
  servers: McpServerConfig[]
): Promise<void> => {
  await preferences.set(SETTINGS_KEYS.mcpServers, JSON.stringify(servers))
}

export const persistMcpDiscovery = async (
  preferences: PreferencesStore,
  discovery: Record<string, McpDiscoveryResult>
): Promise<void> => {
  await preferences.set(SETTINGS_KEYS.mcpDiscovery, JSON.stringify(discovery))
}

export const persistSelectedModel = async (
  preferences: PreferencesStore,
  model: string
): Promise<string> => {
  const normalizedModel = normalizeSelectedModel(model)
  await preferences.set(SETTINGS_KEYS.selectedModel, normalizedModel)
  return normalizedModel
}

export const persistBooleanPreference = async (
  preferences: PreferencesStore,
  key: string,
  value: boolean
): Promise<boolean> => {
  await preferences.set(key, String(value))
  return value
}
