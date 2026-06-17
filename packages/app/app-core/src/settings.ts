import {
  DEFAULT_MODEL,
  LITELLM_DEPLOYMENT_DEFAULT,
  normalizeLiteLLMBaseUrl,
  normalizeSelectedModel
} from './models'
import type { PreferencesStore } from './ports'
import {
  agentTypeSchema,
  mcpDiscoveryResultSchema,
  mcpServerConfigSchema,
  pluginActivationStateSchema,
  type AgentType,
  type McpDiscoveryResult,
  type McpServerConfig,
  type PluginActivationState
} from '@tinytinkerer/contracts'

const DEFAULT_AGENT_TYPE: AgentType = 'react'

export const SETTINGS_KEYS = {
  selectedModel: 'settings_selected_model',
  litellmBaseUrl: 'settings_litellm_base_url',
  agentType: 'settings_agent_type',
  webSpeechEnabled: 'settings_web_speech_enabled',
  showReasoningActivity: 'settings_show_reasoning_activity',
  showCodeBlockFullscreenButton: 'settings_show_code_block_fullscreen_button',
  mcpServers: 'settings_mcp_servers',
  mcpDiscovery: 'settings_mcp_discovery',
  telemetryEnabled: 'settings_telemetry_enabled',
  pluginActivation: 'settings_plugins_activation'
} as const

export type SettingsState = {
  hydrated: boolean
  selectedModel: string
  litellmBaseUrl: string
  agentType: AgentType
  webSpeechEnabled: boolean
  showReasoningActivity: boolean
  showCodeBlockFullscreenButton: boolean
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
  telemetryEnabled: boolean
  pluginActivation: PluginActivationState
}

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

const parseAgentType = (value: string | undefined): AgentType => {
  const result = agentTypeSchema.safeParse(value)
  return result.success ? result.data : DEFAULT_AGENT_TYPE
}

export const defaultSettingsState = (): SettingsState => ({
  hydrated: false,
  selectedModel: DEFAULT_MODEL,
  litellmBaseUrl: LITELLM_DEPLOYMENT_DEFAULT,
  agentType: DEFAULT_AGENT_TYPE,
  webSpeechEnabled: false,
  showReasoningActivity: false,
  showCodeBlockFullscreenButton: true,
  mcpServers: [],
  mcpDiscovery: {},
  telemetryEnabled: false,
  pluginActivation: {}
})

export const loadSettingsState = async (preferences: PreferencesStore): Promise<SettingsState> => {
  const [
    selectedModel,
    litellmBaseUrl,
    agentType,
    webSpeechEnabled,
    showReasoningActivity,
    showCodeBlockFullscreenButton,
    mcpServersRaw,
    mcpDiscoveryRaw,
    telemetryEnabled,
    pluginActivationRaw
  ] = await Promise.all([
    preferences.get(SETTINGS_KEYS.selectedModel),
    preferences.get(SETTINGS_KEYS.litellmBaseUrl),
    preferences.get(SETTINGS_KEYS.agentType),
    preferences.get(SETTINGS_KEYS.webSpeechEnabled),
    preferences.get(SETTINGS_KEYS.showReasoningActivity),
    preferences.get(SETTINGS_KEYS.showCodeBlockFullscreenButton),
    preferences.get(SETTINGS_KEYS.mcpServers),
    preferences.get(SETTINGS_KEYS.mcpDiscovery),
    preferences.get(SETTINGS_KEYS.telemetryEnabled),
    preferences.get(SETTINGS_KEYS.pluginActivation)
  ])

  return {
    hydrated: true,
    selectedModel: normalizeSelectedModel(selectedModel),
    litellmBaseUrl: normalizeLiteLLMBaseUrl(litellmBaseUrl),
    agentType: parseAgentType(agentType),
    webSpeechEnabled: parseBool(webSpeechEnabled, false),
    showReasoningActivity: parseBool(showReasoningActivity, false),
    showCodeBlockFullscreenButton: parseBool(showCodeBlockFullscreenButton, true),
    mcpServers: parseMcpServers(mcpServersRaw),
    mcpDiscovery: parseMcpDiscovery(mcpDiscoveryRaw),
    telemetryEnabled: parseBool(telemetryEnabled, false),
    pluginActivation: parsePluginActivation(pluginActivationRaw)
  }
}

const parsePluginActivation = (raw: string | undefined): PluginActivationState => {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = pluginActivationStateSchema.safeParse(parsed)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}

export const persistPluginActivation = async (
  preferences: PreferencesStore,
  activation: PluginActivationState
): Promise<void> => {
  await preferences.set(SETTINGS_KEYS.pluginActivation, JSON.stringify(activation))
}

// Whether a plugin is active: an explicit user choice (stored `true`/`false`)
// always wins; with no stored entry the plugin's own `defaultEnabled` decides
// (defaulting to off). Takes a minimal manifest shape so app-core stays free of
// the agent-core PluginManifest import.
export const isPluginEnabled = (
  activation: PluginActivationState,
  manifest: { id: string; defaultEnabled?: boolean }
): boolean => activation[manifest.id] ?? manifest.defaultEnabled ?? false

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

export const persistLiteLLMBaseUrl = async (
  preferences: PreferencesStore,
  baseUrl: string | null
): Promise<string> => {
  const normalized = normalizeLiteLLMBaseUrl(baseUrl)
  await preferences.set(SETTINGS_KEYS.litellmBaseUrl, normalized)
  return normalized
}

export const persistAgentType = async (
  preferences: PreferencesStore,
  agentType: AgentType
): Promise<AgentType> => {
  const normalized = parseAgentType(agentType)
  await preferences.set(SETTINGS_KEYS.agentType, normalized)
  return normalized
}

export const persistBooleanPreference = async (
  preferences: PreferencesStore,
  key: string,
  value: boolean
): Promise<boolean> => {
  await preferences.set(key, String(value))
  return value
}
