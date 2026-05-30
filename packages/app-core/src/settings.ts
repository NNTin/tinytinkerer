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
  webSpeechEnabled: 'settings_web_speech_enabled',
  showReasoningActivity: 'settings_show_reasoning_activity',
  showCodeBlockFullscreenButton: 'settings_show_code_block_fullscreen_button',
  mcpServers: 'settings_mcp_servers',
  mcpDiscovery: 'settings_mcp_discovery',
  telemetryEnabled: 'settings_telemetry_enabled'
} as const

// Superseded by the merged `showReasoningActivity` toggle; read once at load for
// back-compat migration of users who set either of the old toggles.
const LEGACY_SETTINGS_KEYS = {
  showThinkingTimeline: 'settings_show_thinking_timeline',
  showToolActivity: 'settings_show_tool_activity'
} as const

export type SettingsState = {
  hydrated: boolean
  selectedModel: string
  searchEnabled: boolean
  webSpeechEnabled: boolean
  showReasoningActivity: boolean
  showCodeBlockFullscreenButton: boolean
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
  telemetryEnabled: boolean
}

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

const parseBoolOptional = (value: string | undefined): boolean | undefined => {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

export const defaultSettingsState = (): SettingsState => ({
  hydrated: false,
  selectedModel: DEFAULT_MODEL,
  searchEnabled: true,
  webSpeechEnabled: false,
  showReasoningActivity: false,
  showCodeBlockFullscreenButton: true,
  mcpServers: [],
  mcpDiscovery: {},
  telemetryEnabled: false
})

export const loadSettingsState = async (preferences: PreferencesStore): Promise<SettingsState> => {
  const [
    selectedModel,
    searchEnabled,
    webSpeechEnabled,
    showReasoningActivity,
    legacyThinkingTimeline,
    legacyToolActivity,
    showCodeBlockFullscreenButton,
    mcpServersRaw,
    mcpDiscoveryRaw,
    telemetryEnabled
  ] = await Promise.all([
    preferences.get(SETTINGS_KEYS.selectedModel),
    preferences.get(SETTINGS_KEYS.searchEnabled),
    preferences.get(SETTINGS_KEYS.webSpeechEnabled),
    preferences.get(SETTINGS_KEYS.showReasoningActivity),
    preferences.get(LEGACY_SETTINGS_KEYS.showThinkingTimeline),
    preferences.get(LEGACY_SETTINGS_KEYS.showToolActivity),
    preferences.get(SETTINGS_KEYS.showCodeBlockFullscreenButton),
    preferences.get(SETTINGS_KEYS.mcpServers),
    preferences.get(SETTINGS_KEYS.mcpDiscovery),
    preferences.get(SETTINGS_KEYS.telemetryEnabled)
  ])

  // When the merged key is unset, migrate: enabled if either legacy toggle was on.
  const reasoningActivity =
    parseBoolOptional(showReasoningActivity) ??
    (parseBool(legacyThinkingTimeline, false) || parseBool(legacyToolActivity, false))

  return {
    hydrated: true,
    selectedModel: normalizeSelectedModel(selectedModel),
    searchEnabled: parseBool(searchEnabled, true),
    webSpeechEnabled: parseBool(webSpeechEnabled, false),
    showReasoningActivity: reasoningActivity,
    showCodeBlockFullscreenButton: parseBool(showCodeBlockFullscreenButton, true),
    mcpServers: parseMcpServers(mcpServersRaw),
    mcpDiscovery: parseMcpDiscovery(mcpDiscoveryRaw),
    telemetryEnabled: parseBool(telemetryEnabled, false)
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
