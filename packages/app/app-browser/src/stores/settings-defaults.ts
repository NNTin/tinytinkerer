// Entry-safe duplicate of `@tinytinkerer/app-core`'s `SETTINGS_KEYS` and
// `defaultSettingsState` (issue #441). createSettingsStore builds its initial
// state synchronously at startup (before the async `initialize()` hydration
// runs), so it cannot get these from the lazy `loadCoreModule()` the rest of
// the store uses. A static VALUE import from `@tinytinkerer/app-core` would
// drag its entire manualChunks bucket — merged with agent-core and contracts
// into one ~123 kB chunk (see scripts/browser-shell-chunks.mjs) — onto the
// entry's static graph, defeating that chunk's lazy load elsewhere.
//
// Keep these values identical to packages/app/app-core/src/settings.ts and
// packages/app/app-core/src/models.ts; settings-defaults.test.ts asserts the
// two never drift.
import type { SettingsState as CoreSettingsState } from '@tinytinkerer/app-core'

const DEFAULT_MODEL = 'chatgpt/gpt-5.4'
const LITELLM_DEPLOYMENT_DEFAULT = ''
const DEFAULT_AGENT_TYPE: CoreSettingsState['agentType'] = 'react'

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
  pluginDisabledTools: 'settings_plugins_disabled_tools',
  appDisabledTools: 'settings_apps_disabled_tools'
} as const

export const defaultSettingsState = (): CoreSettingsState => ({
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
  pluginDisabledTools: {},
  appToolDisablement: {}
})
