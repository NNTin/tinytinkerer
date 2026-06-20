// =============================================================================
// plugin-context-usage — a STATUS plugin: a persistent context-window gauge.
// =============================================================================
//
// WHAT THIS PLUGIN DOES
// ---------------------
// It contributes a small, always-visible SVG "wheel"/gauge (rendered by the
// host near the composer) showing what share of the selected model's input
// context window is currently used — `percent_context_used`. It ships NO tools
// and NO hooks: it only provides a pure mapper (`summarizeStatus`) that turns
// the numbers the host already has (the model's context window and the latest
// reported prompt-token usage) into a React-free `GaugeView` the host's single
// generic gauge renderer draws. When either number is unavailable the mapper
// returns null and the host shows nothing. Off by default; toggle in Settings.
//
// THE 'status' CAPABILITY
// -----------------------
// `ActivityView`/`PermissionView` are transient, tool-scoped views. A gauge is a
// PERSISTENT host surface, so this plugin advertises the `'status'` capability
// and carries a `statusDescriptor` on its manifest (see PluginStatusDescriptor
// in @tinytinkerer/contracts). The host resolves `summarizeStatus` from the
// active plugin's manifest — same "plugins ship data, never components" rule as
// the activity/permission view-models. Keep this file dependency-light and
// host-agnostic: import only from @tinytinkerer/contracts (enforced by
// scripts/check-boundaries.mjs).
// =============================================================================

import type { AgentPlugin, PluginManifest, PluginModule } from '@tinytinkerer/contracts'
import { CONTEXT_USAGE_PLUGIN_ID } from './plugin-id'
import { computeContextGauge } from './gauge-view'

export { CONTEXT_USAGE_PLUGIN_ID } from './plugin-id'
export { computeContextGauge, thresholdForPercent } from './gauge-view'

// Host-facing metadata. `label` + `description` render verbatim in the Settings
// modal, so they are written for an end user. `capabilities: ['status']`
// advertises the persistent gauge contribution (no tools, no hooks). The
// `statusDescriptor` carries the plugin's pure presentation mapper.
export const contextUsagePluginManifest: PluginManifest = {
  id: CONTEXT_USAGE_PLUGIN_ID,
  label: 'Context usage gauge',
  description:
    'Show a small gauge near the message box with how much of the model context ' +
    'window is currently in use (healthy / warning / critical). The gauge is ' +
    'hidden until the model reports token usage and its context-window size is ' +
    'known. Off by default.',
  capabilities: ['status'],
  statusDescriptor: {
    id: CONTEXT_USAGE_PLUGIN_ID,
    gaugeType: 'context_usage',
    summarizeStatus: computeContextGauge
  }
}

// The plugin factory. A status-only plugin contributes neither tools nor hooks,
// so the runtime gets a bare AgentPlugin; all presentation lives in the manifest
// descriptor the host reads.
export const contextUsagePlugin = (): AgentPlugin => ({
  id: CONTEXT_USAGE_PLUGIN_ID
})

// PluginModule contract surface: the named exports the host discovers
// dynamically via the `import.meta.glob`. `manifest` and `createPlugin` are the
// only members the host relies on, so it never needs to know this package by name.
export const manifest: PluginManifest = contextUsagePluginManifest
export const createPlugin: PluginModule['createPlugin'] = contextUsagePlugin
