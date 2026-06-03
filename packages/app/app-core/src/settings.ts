import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_MODELS_BY_PROVIDER,
  normalizeModelProvider,
  normalizeSelectedModel,
  normalizeSelectedModelForProvider
} from './models'
import type { PreferencesStore } from './ports'
import {
  agentTypeSchema,
  mcpDiscoveryResultSchema,
  mcpServerConfigSchema,
  type AgentType,
  type McpDiscoveryResult,
  type McpServerConfig,
  type ModelProviderId
} from '@tinytinkerer/contracts'

const DEFAULT_AGENT_TYPE: AgentType = 'react'

export const SETTINGS_KEYS = {
  selectedModel: 'settings_selected_model',
  selectedModelProvider: 'settings_model_provider',
  selectedModelsByProvider: 'settings_selected_models_by_provider',
  openRouterApiKey: 'settings_openrouter_api_key',
  agentType: 'settings_agent_type',
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
  selectedModelProvider: ModelProviderId
  selectedModel: string
  selectedModelsByProvider: Record<ModelProviderId, string>
  openRouterApiKey: string | null
  agentType: AgentType
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

const parseAgentType = (value: string | undefined): AgentType => {
  const result = agentTypeSchema.safeParse(value)
  return result.success ? result.data : DEFAULT_AGENT_TYPE
}

export const defaultSettingsState = (): SettingsState => ({
  hydrated: false,
  selectedModelProvider: DEFAULT_MODEL_PROVIDER,
  selectedModel: DEFAULT_MODEL,
  selectedModelsByProvider: { ...DEFAULT_MODELS_BY_PROVIDER },
  openRouterApiKey: null,
  agentType: DEFAULT_AGENT_TYPE,
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
    selectedModelProviderRaw,
    selectedModelsByProviderRaw,
    openRouterApiKey,
    agentType,
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
    preferences.get(SETTINGS_KEYS.selectedModelProvider),
    preferences.get(SETTINGS_KEYS.selectedModelsByProvider),
    preferences.get(SETTINGS_KEYS.openRouterApiKey),
    preferences.get(SETTINGS_KEYS.agentType),
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

  const selectedModelProvider = normalizeModelProvider(selectedModelProviderRaw)
  const selectedModelsByProvider = parseSelectedModelsByProvider(
    selectedModelsByProviderRaw,
    selectedModel
  )

  return {
    hydrated: true,
    selectedModelProvider,
    selectedModel: normalizeSelectedModelForProvider(
      selectedModelProvider,
      selectedModelsByProvider[selectedModelProvider]
    ),
    selectedModelsByProvider,
    openRouterApiKey: openRouterApiKey || null,
    agentType: parseAgentType(agentType),
    searchEnabled: parseBool(searchEnabled, true),
    webSpeechEnabled: parseBool(webSpeechEnabled, false),
    showReasoningActivity: reasoningActivity,
    showCodeBlockFullscreenButton: parseBool(showCodeBlockFullscreenButton, true),
    mcpServers: parseMcpServers(mcpServersRaw),
    mcpDiscovery: parseMcpDiscovery(mcpDiscoveryRaw),
    telemetryEnabled: parseBool(telemetryEnabled, false)
  }
}

const parseSelectedModelsByProvider = (
  raw: string | undefined,
  legacySelectedModel: string | undefined
): Record<ModelProviderId, string> => {
  const models: Record<ModelProviderId, string> = {
    ...DEFAULT_MODELS_BY_PROVIDER,
    github: normalizeSelectedModel(legacySelectedModel)
  }

  if (!raw) return models
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return models
    }
    const record = parsed as Partial<Record<ModelProviderId, unknown>>
    for (const provider of ['github', 'openrouter'] as const) {
      const value = record[provider]
      if (typeof value === 'string' && value.trim()) {
        models[provider] = value
      }
    }
  } catch {
    return models
  }
  return models
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
  model: string,
  provider: ModelProviderId = DEFAULT_MODEL_PROVIDER,
  currentModelsByProvider?: Record<ModelProviderId, string>
): Promise<string> => {
  const normalizedModel = normalizeSelectedModelForProvider(provider, model)
  const modelsByProvider = {
    ...DEFAULT_MODELS_BY_PROVIDER,
    ...(currentModelsByProvider ?? {}),
    [provider]: normalizedModel
  }
  await preferences.set(SETTINGS_KEYS.selectedModel, normalizedModel)
  await preferences.set(
    SETTINGS_KEYS.selectedModelsByProvider,
    JSON.stringify(modelsByProvider)
  )
  return normalizedModel
}

export const persistSelectedModelProvider = async (
  preferences: PreferencesStore,
  provider: ModelProviderId
): Promise<ModelProviderId> => {
  const normalized = normalizeModelProvider(provider)
  await preferences.set(SETTINGS_KEYS.selectedModelProvider, normalized)
  return normalized
}

export const persistOpenRouterApiKey = async (
  preferences: PreferencesStore,
  apiKey: string | null
): Promise<string | null> => {
  const normalized = apiKey?.trim() || null
  await preferences.set(SETTINGS_KEYS.openRouterApiKey, normalized ?? '')
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
