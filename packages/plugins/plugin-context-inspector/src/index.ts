// =============================================================================
// plugin-context-inspector — an INSPECTOR plugin: a developer debug view of the
// exact LLM context (issue #270).
// =============================================================================
//
// WHAT THIS PLUGIN DOES
// ---------------------
// It contributes a developer panel (rendered by the host) showing the EXACT chat
// request the client forwards to the provider for each model call — the messages
// array (system prompt + conversation history + tool observations), the model, and
// stream options. It ships NO tools and NO hooks: it only provides a pure mapper
// (`summarizeRequest`) that turns a host-captured request payload into a React-free
// `InspectorView` the host's generic inspector renderer draws. Off by default;
// toggle in Settings.
//
// THE 'inspector' CAPABILITY
// --------------------------
// Like the context-usage gauge's `'status'` capability, this is a PERSISTENT,
// developer-facing host surface, so the plugin advertises the `'inspector'`
// capability and carries a `inspectorDescriptor` on its manifest (see
// PluginInspectorDescriptor in @tinytinkerer/contracts). The host arms request
// capture ONLY while this plugin is enabled and keeps the captured payload
// client-side (never telemetry) — see issue #270's privacy requirement. Keep this
// file dependency-light and host-agnostic: import only from
// @tinytinkerer/contracts (enforced by scripts/check-boundaries.mjs).
// =============================================================================

import type { AgentPlugin, PluginManifest, PluginModule } from '@tinytinkerer/contracts'
import { CONTEXT_INSPECTOR_PLUGIN_ID } from './plugin-id'
import { summarizeRequest } from './inspector-view'

export { CONTEXT_INSPECTOR_PLUGIN_ID } from './plugin-id'
export { summarizeRequest } from './inspector-view'

// Host-facing metadata. `label` + `description` render verbatim in the Settings
// modal, so they are written for a developer. `capabilities: ['inspector']`
// advertises the persistent debug panel (no tools, no hooks). The
// `inspectorDescriptor` carries the plugin's pure presentation mapper.
export const contextInspectorPluginManifest: PluginManifest = {
  id: CONTEXT_INSPECTOR_PLUGIN_ID,
  label: 'Context inspector (developer)',
  description:
    'Show a developer panel with the exact context sent to the model each turn — the ' +
    'system prompt, conversation history, and tool results — plus the model and token ' +
    'estimates. The captured request stays on this device and is never sent anywhere. ' +
    'Web app only. Off by default.',
  capabilities: ['inspector'],
  inspectorDescriptor: {
    id: CONTEXT_INSPECTOR_PLUGIN_ID,
    summarizeRequest
  }
}

// The plugin factory. An inspector-only plugin contributes neither tools nor
// hooks, so the runtime gets a bare AgentPlugin; all presentation lives in the
// manifest descriptor the host reads, and capture is armed host-side off the
// plugin's activation state.
export const contextInspectorPlugin = (): AgentPlugin => ({
  id: CONTEXT_INSPECTOR_PLUGIN_ID
})

// PluginModule contract surface: the named exports the host discovers dynamically
// via the `import.meta.glob`. `manifest` and `createPlugin` are the only members
// the host relies on, so it never needs to know this package by name.
export const manifest: PluginManifest = contextInspectorPluginManifest
export const createPlugin: PluginModule['createPlugin'] = contextInspectorPlugin
