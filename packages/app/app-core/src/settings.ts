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
  pluginConfigStateSchema,
  pluginToolDisablementStateSchema,
  type AgentType,
  type McpDiscoveryResult,
  type McpServerConfig,
  type PluginActivationState,
  type PluginConfigState,
  type PluginSettingsDescriptor,
  type PluginToolDisablementState
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
  pluginActivation: 'settings_plugins_activation',
  pluginConfig: 'settings_plugins_config',
  pluginDisabledTools: 'settings_plugins_disabled_tools'
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
  pluginConfig: PluginConfigState
  pluginDisabledTools: PluginToolDisablementState
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
  pluginActivation: {},
  pluginConfig: {},
  pluginDisabledTools: {}
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
    pluginActivationRaw,
    pluginConfigRaw,
    pluginDisabledToolsRaw
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
    preferences.get(SETTINGS_KEYS.pluginActivation),
    preferences.get(SETTINGS_KEYS.pluginConfig),
    preferences.get(SETTINGS_KEYS.pluginDisabledTools)
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
    pluginActivation: parsePluginActivation(pluginActivationRaw),
    pluginConfig: parsePluginConfig(pluginConfigRaw),
    pluginDisabledTools: parsePluginToolDisablement(pluginDisabledToolsRaw)
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

// Per-tool disablement for an enabled plugin (issue #400). Same shape/flow as
// activation: parse a validated map of pluginId -> disabled tool ids on load;
// persist the whole map on every change.
const parsePluginToolDisablement = (raw: string | undefined): PluginToolDisablementState => {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = pluginToolDisablementStateSchema.safeParse(parsed)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}

export const persistPluginToolDisablement = async (
  preferences: PreferencesStore,
  disabledTools: PluginToolDisablementState
): Promise<void> => {
  await preferences.set(SETTINGS_KEYS.pluginDisabledTools, JSON.stringify(disabledTools))
}

// Whether one tool of an (already-enabled) plugin is active: mirrors
// `isPluginEnabled`'s "absent = on" default, but for the denylist shape — a
// missing plugin key, a missing tool name, or an empty array all mean enabled.
// Does NOT consult plugin activation itself: callers gate on `isPluginEnabled`
// separately (a tool of a disabled plugin never reaches this check).
export const isPluginToolEnabled = (
  disabledTools: PluginToolDisablementState,
  pluginId: string,
  toolId: string
): boolean => !(disabledTools[pluginId]?.includes(toolId) ?? false)

// Result of applying one tree-selection change (issue #400): the new
// disabledTools map, the new activation map (only ever touched to flip the
// plugin itself off), and whether that flip happened — the settings UI uses
// `pluginDisabled` to reflect the plugin's own toggle without re-deriving it.
export type PluginToolSelectionResult = {
  disabledTools: PluginToolDisablementState
  activation: PluginActivationState
  pluginDisabled: boolean
}

// The ONE policy chokepoint for turning a user's tool-tree selection into
// persisted state (issue #400) — every caller (settings UI today, anything
// else later) must route a selection change through here so the invariants
// below hold everywhere, not just where someone remembered them.
//
// `disabledToolIds` is normalized first: intersected with the plugin's CURRENT
// `toolIds` and de-duplicated. Intersecting is what garbage-collects a stale
// tool name left over from an older version of the plugin (a renamed/removed
// tool can never appear in the persisted entry again once this runs).
//
// - All of the plugin's tools end up disabled (and it has at least one tool):
//   delete its disabledTools entry and flip plugin ACTIVATION off instead.
//   Disabling every tool IS disabling the plugin, and clearing the entry means
//   a later re-enable comes back with every tool checked, not silently
//   pre-disabled from a stale selection (documented decision).
// - None end up disabled: delete the entry — absence already means "all
//   enabled", so an explicit empty array would just be a redundant encoding of
//   the same fact.
// - Otherwise: store the normalized ids, ordered to match `plugin.toolIds` (not
//   the caller's array order) so the persisted array is deterministic across
//   equivalent selections.
// - A plugin with zero declared tools is a no-op: any stale entry for it is
//   dropped, activation is left untouched, and `pluginDisabled` is false —
//   there is no tool to disable and nothing to fall back on.
//
// Pure: always returns fresh objects, never mutates `current`.
export const applyPluginToolSelection = (
  current: { activation: PluginActivationState; disabledTools: PluginToolDisablementState },
  plugin: { id: string; toolIds: readonly string[] },
  disabledToolIds: readonly string[]
): PluginToolSelectionResult => {
  const disabledTools = { ...current.disabledTools }

  if (plugin.toolIds.length === 0) {
    delete disabledTools[plugin.id]
    return { disabledTools, activation: current.activation, pluginDisabled: false }
  }

  const requested = new Set(disabledToolIds)
  const normalized = plugin.toolIds.filter((toolId) => requested.has(toolId))

  if (normalized.length === plugin.toolIds.length) {
    delete disabledTools[plugin.id]
    return {
      disabledTools,
      activation: { ...current.activation, [plugin.id]: false },
      pluginDisabled: true
    }
  }

  if (normalized.length === 0) {
    delete disabledTools[plugin.id]
  } else {
    disabledTools[plugin.id] = normalized
  }

  return { disabledTools, activation: current.activation, pluginDisabled: false }
}

// Per-plugin CONFIGURATION (issue #85). Same shape/flow as activation: parse a
// validated map of pluginId -> (settingKey -> value) on load; persist the whole map
// on every change.
const parsePluginConfig = (raw: string | undefined): PluginConfigState => {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = pluginConfigStateSchema.safeParse(parsed)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}

export const persistPluginConfig = async (
  preferences: PreferencesStore,
  config: PluginConfigState
): Promise<void> => {
  await preferences.set(SETTINGS_KEYS.pluginConfig, JSON.stringify(config))
}

// Current value of one declared plugin setting: an explicit stored value always wins;
// with no stored entry the manifest field's own `default` decides. Mirrors
// `isPluginEnabled` for the richer config map, and is the single source of truth the
// settings UI and the host renderers read. Returns `undefined` only for an unknown key
// (no stored value and no declared field).
export const resolvePluginSetting = (
  config: PluginConfigState,
  manifest: { id: string; settingsDescriptor?: PluginSettingsDescriptor },
  key: string
): string | boolean | undefined => {
  const stored = config[manifest.id]?.[key]
  if (stored !== undefined) return stored
  return manifest.settingsDescriptor?.fields.find((field) => field.key === key)?.default
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
