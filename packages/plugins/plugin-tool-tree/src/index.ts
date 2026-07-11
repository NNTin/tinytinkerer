// =============================================================================
// plugin-tool-tree — a TOOL-TREE plugin: a compose-area tool picker (issue #400).
// =============================================================================
//
// WHAT THIS PLUGIN DOES
// ----------------------
// It contributes a button the host renders next to the composer that opens the
// registered tools of every enabled plugin as a tree — plugin → tools — each with
// an enable checkbox, so the assistant can be narrowed to a subset of tools without
// leaving the conversation. It ships NO tools and NO hooks: it only provides a pure
// mapper (`summarizeToolTree`) that turns host-supplied tree data into a
// React-free `ToolTreeView` the host's generic tree renderer draws. Unchecking
// every tool of a plugin disables that plugin (the app-core policy chokepoint,
// `applyPluginToolSelection`, owns that rule — this plugin only presents the
// current state). Off by default; toggle in Settings.
//
// THE 'tool-tree' CAPABILITY
// ---------------------------
// Like the context-usage gauge's `'status'` capability and the context inspector's
// `'inspector'` capability, this is a PERSISTENT, always-available host surface, so
// the plugin advertises the `'tool-tree'` capability and carries a
// `toolTreeDescriptor` on its manifest (see PluginToolTreeDescriptor in
// @tinytinkerer/contracts). The host resolves the descriptor from the first
// ENABLED plugin contributing one. Keep this file dependency-light and
// host-agnostic: import only from @tinytinkerer/contracts (enforced by
// scripts/check-boundaries.mjs).
// =============================================================================

import type { AgentPlugin, PluginManifest, PluginModule } from '@tinytinkerer/contracts'
import { TOOL_TREE_PLUGIN_ID } from './plugin-id'
import { summarizeToolTree } from './tool-tree-view'

export { TOOL_TREE_PLUGIN_ID } from './plugin-id'
export { summarizeToolTree } from './tool-tree-view'

// Host-facing metadata. `label` + `description` render verbatim in the Settings
// modal, so they are written for any user (not just a developer, unlike the
// context inspector). The `toolTreeDescriptor` carries the plugin's pure
// presentation mapper (the compose-area tool picker; no tools, no hooks). The host
// resolves it by its presence on the manifest.
export const toolTreePluginManifest: PluginManifest = {
  id: TOOL_TREE_PLUGIN_ID,
  label: 'Tool picker (tree view)',
  description:
    'Add a tool-picker button next to the composer: it opens the registered tools of ' +
    'every enabled plugin as a tree with checkboxes, so the assistant can be narrowed ' +
    'to a subset of tools. Unchecking all tools of a plugin disables that plugin. Off ' +
    'by default.',
  toolTreeDescriptor: {
    id: TOOL_TREE_PLUGIN_ID,
    summarizeToolTree
  }
}

// The plugin factory. A tool-tree-only plugin contributes neither tools nor hooks,
// so the runtime gets a bare AgentPlugin; all presentation lives in the manifest
// descriptor the host reads.
export const toolTreePlugin = (): AgentPlugin => ({
  id: TOOL_TREE_PLUGIN_ID
})

// PluginModule contract surface: the named exports the host discovers dynamically
// via the `import.meta.glob`. `manifest` and `createPlugin` are the only members
// the host relies on, so it never needs to know this package by name.
export const manifest: PluginManifest = toolTreePluginManifest
export const createPlugin: PluginModule['createPlugin'] = toolTreePlugin
