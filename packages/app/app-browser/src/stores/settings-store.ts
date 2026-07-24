import type { AgentType, McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import type { SettingsState as CoreSettingsState } from '@tinytinkerer/app-core'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { BrowserShell } from '../shell'
import { loadCoreModule } from '../core-module'
import { setTelemetryConsent } from '../telemetry/telemetry'
import { SETTINGS_KEYS, defaultSettingsState } from './settings-defaults'

// The browser store layers UI-only state and actions onto the headless
// app-core settings shape. The data fields and their storage keys live in
// app-core/src/settings.ts; importing them keeps the two in lockstep.
type SettingsActions = {
  initialize: () => Promise<void>
  setSelectedModel: (model: string) => Promise<void>
  setLiteLLMBaseUrl: (baseUrl: string | null) => Promise<void>
  setAgentType: (agentType: AgentType) => Promise<void>
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
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>
  setPluginSetting: (pluginId: string, key: string, value: string | boolean) => Promise<void>
  // Apply a tool-tree selection change for one plugin (issue #400). `toolIds` is
  // the plugin's full CURRENT tool id list (for normalization/GC);
  // `disabledToolIds` is the desired denylist for that plugin after this change.
  setPluginToolSelection: (
    plugin: { id: string; toolIds: string[] },
    disabledToolIds: string[]
  ) => Promise<void>
  // Apply a tool-tree selection change for one APP tool group (issue #400
  // follow-up). Same call shape as setPluginToolSelection, but routes through the
  // app-tool policy (applyAppToolSelection): no activation is touched, and
  // disabling every tool is a persisted state that keeps the group in the picker.
  setAppToolSelection: (
    group: { id: string; toolIds: string[] },
    disabledToolIds: string[]
  ) => Promise<void>
  // Discovery-time sweep (issue #400 review, F2/F3): re-validate every stored
  // denylist entry against the CURRENT set of discovered plugins/tool ids. Wired
  // to run once per session where plugin discovery meets hydrated settings (see
  // app.ts, initializeBrowserApp) — never called on every render.
  reconcilePluginTools: (plugins: { id: string; toolIds: string[] }[]) => Promise<void>
}

export type SettingsState = CoreSettingsState & {
  /** Validation message from the last setLiteLLMBaseUrl attempt, or null. */
  litellmBaseUrlError: string | null
} & SettingsActions

export type SettingsStore = StoreApi<SettingsState>

export const createSettingsStore = (shell: BrowserShell): SettingsStore =>
  createStore<SettingsState>((set, get) => ({
    ...defaultSettingsState(),
    litellmBaseUrlError: null,
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
    setLiteLLMBaseUrl: async (baseUrl) => {
      const { persistLiteLLMBaseUrl, validateLiteLLMBaseUrl } = await loadCoreModule()
      // Reject invalid input with an inline message instead of silently
      // persisting the default — the input used to visibly jump after Save
      // with no explanation (issue #179).
      const validation = validateLiteLLMBaseUrl(baseUrl)
      if (!validation.ok) {
        set({ litellmBaseUrlError: validation.error })
        return
      }
      const normalized = await persistLiteLLMBaseUrl(shell.preferences, baseUrl)
      set({ litellmBaseUrl: normalized, litellmBaseUrlError: null })
    },
    setAgentType: async (agentType) => {
      const { persistAgentType } = await loadCoreModule()
      const normalized = await persistAgentType(shell.preferences, agentType)
      set({ agentType: normalized })
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
    },
    setPluginEnabled: async (pluginId, enabled) => {
      const { persistPluginActivation } = await loadCoreModule()
      const nextActivation = { ...get().pluginActivation, [pluginId]: enabled }
      await persistPluginActivation(shell.preferences, nextActivation)
      set({ pluginActivation: nextActivation })
    },
    setPluginSetting: async (pluginId, key, value) => {
      const { persistPluginConfig } = await loadCoreModule()
      const current = get().pluginConfig
      const nextConfig = {
        ...current,
        [pluginId]: { ...current[pluginId], [key]: value }
      }
      await persistPluginConfig(shell.preferences, nextConfig)
      set({ pluginConfig: nextConfig })
    },
    setPluginToolSelection: async (plugin, disabledToolIds) => {
      // Route every caller through app-core's ONE policy chokepoint
      // (applyPluginToolSelection) so the "unchecking every tool disables the
      // plugin, and its denylist entry is cleared" invariant lives in one place,
      // not re-implemented per caller.
      const { applyPluginToolSelection, persistPluginToolDisablement, persistPluginActivation } =
        await loadCoreModule()
      const current = get()
      const result = applyPluginToolSelection(
        { activation: current.pluginActivation, disabledTools: current.pluginDisabledTools },
        plugin,
        disabledToolIds
      )
      // Activation-first when the change disables the plugin (issue #400 review,
      // F4): the two writes encode ONE user decision ("turn this plugin off"). If
      // the second write is lost mid-flight, activation-first leaves the plugin
      // OFF with a stale denylist entry — harmless, since absence semantics are
      // unaffected and discovery-time reconciliation (reconcilePluginToolDisablement)
      // sweeps it up later. The old denylist-first order failed the other way: a
      // lost activation write left the plugin fully re-armed with every tool
      // enabled — the inverse of what the user asked for.
      if (result.pluginDisabled) {
        await persistPluginActivation(shell.preferences, result.activation)
        set({ pluginActivation: result.activation })
      }
      await persistPluginToolDisablement(shell.preferences, result.disabledTools)
      set({ pluginDisabledTools: result.disabledTools })
    },
    setAppToolSelection: async (group, disabledToolIds) => {
      // App tools have no activation surface, so this is a single write through
      // the app-tool chokepoint (applyAppToolSelection): unlike a plugin, disabling
      // every tool does NOT deactivate anything — the normalized denylist (possibly
      // covering every tool) is simply persisted and the group stays in the picker.
      const { applyAppToolSelection, persistAppToolDisablement } = await loadCoreModule()
      const next = applyAppToolSelection(get().appToolDisablement, group, disabledToolIds)
      await persistAppToolDisablement(shell.preferences, next)
      set({ appToolDisablement: next })
    },
    reconcilePluginTools: async (plugins) => {
      // Discovery-time reconciliation (issue #400 review, F2/F3): re-run every
      // plugin's STORED denylist entry through the same policy chokepoint,
      // healing the "all tools disabled, plugin still enabled" ghost state a
      // plugin update can silently create (see reconcilePluginToolDisablement in
      // app-core). Only persists when something actually changed.
      const {
        reconcilePluginToolDisablement,
        persistPluginActivation,
        persistPluginToolDisablement
      } = await loadCoreModule()
      const current = get()
      const result = reconcilePluginToolDisablement(
        { activation: current.pluginActivation, disabledTools: current.pluginDisabledTools },
        plugins
      )
      if (!result.changed) {
        return
      }
      // Same activation-first order as setPluginToolSelection above, same
      // rationale: a lost second write should leave a plugin OFF with a stale
      // entry, not fully re-armed.
      await persistPluginActivation(shell.preferences, result.activation)
      set({ pluginActivation: result.activation })
      await persistPluginToolDisablement(shell.preferences, result.disabledTools)
      set({ pluginDisabledTools: result.disabledTools })
    }
  }))
