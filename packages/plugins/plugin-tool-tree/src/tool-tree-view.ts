import type {
  ToolTreeChecked,
  ToolTreeInput,
  ToolTreePluginInput,
  ToolTreePluginNode,
  ToolTreeSummarizer,
  ToolTreeToolNode,
  ToolTreeView
} from '@tinytinkerer/contracts'

// Tri-state derivation for one plugin's tools: 'all' when every tool is enabled,
// 'none' when none are, 'some' otherwise. A plugin with zero tools never reaches
// this — it is dropped before mapping (see summarizeToolTree) — so `tools` here is
// always non-empty.
const deriveChecked = (tools: { enabled: boolean }[]): ToolTreeChecked => {
  const enabledCount = tools.filter((tool) => tool.enabled).length
  if (enabledCount === tools.length) return 'all'
  if (enabledCount === 0) return 'none'
  return 'some'
}

const toPluginNode = (plugin: ToolTreePluginInput): ToolTreePluginNode => {
  // Sort tools by id so the tree renders deterministically regardless of the
  // plugin's own toolDescriptors declaration order.
  const tools: ToolTreeToolNode[] = [...plugin.tools]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((tool) => ({ id: tool.id, description: tool.description, checked: tool.enabled }))

  const enabledCount = tools.filter((tool) => tool.checked).length

  return {
    id: plugin.id,
    label: plugin.label,
    checked: deriveChecked(plugin.tools),
    enabledCount,
    toolCount: tools.length,
    tools
  }
}

// Pure mapper: host-supplied tree data → the view the host's generic tool-tree
// panel renders. Never touches React/DOM (enforced by
// scripts/check-boundaries.mjs). A plugin with no declared tools has nothing to
// check, so it is dropped defensively here even though the host is expected to
// have already excluded it (documented decision — see ToolTreeInput in
// @tinytinkerer/contracts).
export const summarizeToolTree: ToolTreeSummarizer = (input: ToolTreeInput): ToolTreeView => {
  const plugins = input.plugins
    .filter((plugin) => plugin.tools.length > 0)
    // Sort plugins by label (not id) — the label is what the tree groups by and
    // what the user reads.
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(toPluginNode)

  const enabledCount = plugins.reduce((sum, plugin) => sum + plugin.enabledCount, 0)
  const toolCount = plugins.reduce((sum, plugin) => sum + plugin.toolCount, 0)

  return { plugins, enabledCount, toolCount }
}
