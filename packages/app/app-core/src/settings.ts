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
  searchEnabled: 'settings_search_enabled',
  webSpeechEnabled: 'settings_web_speech_enabled',
  showReasoningActivity: 'settings_show_reasoning_activity',
  showCodeBlockFullscreenButton: 'settings_show_code_block_fullscreen_button',
  mcpServers: 'settings_mcp_servers',
  mcpDiscovery: 'settings_mcp_discovery',
  telemetryEnabled: 'settings_telemetry_enabled',
  pluginActivation: 'settings_plugins_activation'
} as const

// Superseded settings, read once at load for back-compat migration:
// - showThinkingTimeline/showToolActivity merged into `showReasoningActivity`.
// - selectedModelsByProvider held per-provider model picks from the multi-provider
//   era (GitHub Models/OpenRouter); only the litellm entry is migrated forward.
// - openRouterApiKey is a credential from the removed OpenRouter provider; it is
//   cleared from storage on load rather than left behind.
const LEGACY_SETTINGS_KEYS = {
  showThinkingTimeline: 'settings_show_thinking_timeline',
  showToolActivity: 'settings_show_tool_activity',
  selectedModelsByProvider: 'settings_selected_models_by_provider',
  openRouterApiKey: 'settings_openrouter_api_key'
} as const

export type SettingsState = {
  hydrated: boolean
  selectedModel: string
  litellmBaseUrl: string
  agentType: AgentType
  searchEnabled: boolean
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

const parseBoolOptional = (value: string | undefined): boolean | undefined => {
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
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
  searchEnabled: true,
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
    legacyModelsByProviderRaw,
    legacyOpenRouterApiKey,
    litellmBaseUrl,
    agentType,
    searchEnabled,
    webSpeechEnabled,
    showReasoningActivity,
    legacyThinkingTimeline,
    legacyToolActivity,
    showCodeBlockFullscreenButton,
    mcpServersRaw,
    mcpDiscoveryRaw,
    telemetryEnabled,
    pluginActivationRaw
  ] = await Promise.all([
    preferences.get(SETTINGS_KEYS.selectedModel),
    preferences.get(LEGACY_SETTINGS_KEYS.selectedModelsByProvider),
    preferences.get(LEGACY_SETTINGS_KEYS.openRouterApiKey),
    preferences.get(SETTINGS_KEYS.litellmBaseUrl),
    preferences.get(SETTINGS_KEYS.agentType),
    preferences.get(SETTINGS_KEYS.searchEnabled),
    preferences.get(SETTINGS_KEYS.webSpeechEnabled),
    preferences.get(SETTINGS_KEYS.showReasoningActivity),
    preferences.get(LEGACY_SETTINGS_KEYS.showThinkingTimeline),
    preferences.get(LEGACY_SETTINGS_KEYS.showToolActivity),
    preferences.get(SETTINGS_KEYS.showCodeBlockFullscreenButton),
    preferences.get(SETTINGS_KEYS.mcpServers),
    preferences.get(SETTINGS_KEYS.mcpDiscovery),
    preferences.get(SETTINGS_KEYS.telemetryEnabled),
    preferences.get(SETTINGS_KEYS.pluginActivation)
  ])

  // When the merged key is unset, migrate: enabled if either legacy toggle was on.
  const reasoningActivity =
    parseBoolOptional(showReasoningActivity) ??
    (parseBool(legacyThinkingTimeline, false) || parseBool(legacyToolActivity, false))

  // Migrate the litellm pick out of the legacy per-provider map, then clear the
  // map so a stale entry can never override later model changes (which write
  // only `settings_selected_model`).
  let migratedSelectedModel = normalizeSelectedModel(selectedModel)
  const legacyLitellmModel = parseLegacyLitellmModel(legacyModelsByProviderRaw)
  if (legacyLitellmModel) {
    migratedSelectedModel = legacyLitellmModel
    await preferences.set(SETTINGS_KEYS.selectedModel, migratedSelectedModel)
    await preferences.set(LEGACY_SETTINGS_KEYS.selectedModelsByProvider, '')
  }
  if (legacyOpenRouterApiKey?.trim()) {
    await preferences.set(LEGACY_SETTINGS_KEYS.openRouterApiKey, '')
  }

  return {
    hydrated: true,
    selectedModel: migratedSelectedModel,
    litellmBaseUrl: normalizeLiteLLMBaseUrl(litellmBaseUrl),
    agentType: parseAgentType(agentType),
    searchEnabled: parseBool(searchEnabled, true),
    webSpeechEnabled: parseBool(webSpeechEnabled, false),
    showReasoningActivity: reasoningActivity,
    showCodeBlockFullscreenButton: parseBool(showCodeBlockFullscreenButton, true),
    mcpServers: parseMcpServers(mcpServersRaw),
    mcpDiscovery: parseMcpDiscovery(mcpDiscoveryRaw),
    telemetryEnabled: parseBool(telemetryEnabled, false),
    pluginActivation: parsePluginActivation(pluginActivationRaw)
  }
}

const parseLegacyLitellmModel = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return undefined
    }
    const value = (parsed as Record<string, unknown>).litellm
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
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

// Headless helper: the set of plugin ids the user has switched on. A plugin with
// no stored entry (or an explicit `false`) is treated as inactive.
export const resolveActivePluginIds = (
  activation: PluginActivationState
): Set<string> =>
  new Set(
    Object.entries(activation)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id)
  )

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
