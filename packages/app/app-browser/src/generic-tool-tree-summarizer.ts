import type {
  ToolTreeChecked,
  ToolTreeInput,
  ToolTreePluginInput,
  ToolTreePluginNode,
  ToolTreeSummarizer,
  ToolTreeToolNode,
  ToolTreeView
} from '@tinytinkerer/contracts'

// A product-agnostic, host-owned tool-tree mapper — the same shape of pure
// sort/tri-state/count logic `@tinytinkerer/plugin-tool-tree`'s
// `summarizeToolTree` contributes as a plugin descriptor, kept here as a plain
// export instead. app-browser must never statically import a concrete plugin
// (see scripts/check-boundaries.mjs), so a host whose catalogue carries no
// tool-tree-descriptor plugin — or whose reader has switched that plugin off —
// has no other route to a working `useToolTree({ fallbackSummarizer })`. (Before
// issue #495 the example here was the docs Docusaurus/webpack build, which could
// discover no plugins at all; it now injects a catalogue that includes
// `plugin-tool-tree`, so this is a fallback rather than the only path.) The mapper owns no domain
// knowledge (it only sorts/derives tri-state/counts — see
// docs/plugins-and-tools/plugin-infrastructure.md's "outer edge of the
// manifest-descriptor pattern" note), so duplicating it here is a deliberate,
// tiny, reviewable exception to "plugins ship the summarizer" — not a shortcut
// around plugin activation itself, which still gates every OTHER descriptor.
const deriveChecked = (tools: { enabled: boolean }[]): ToolTreeChecked => {
  const enabledCount = tools.filter((tool) => tool.enabled).length
  if (enabledCount === tools.length) return 'all'
  if (enabledCount === 0) return 'none'
  return 'some'
}

const toPluginNode = (plugin: ToolTreePluginInput): ToolTreePluginNode => {
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

export const genericToolTreeSummarizer: ToolTreeSummarizer = (
  input: ToolTreeInput
): ToolTreeView => {
  const plugins = input.plugins
    .filter((plugin) => plugin.tools.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(toPluginNode)

  const enabledCount = plugins.reduce((sum, plugin) => sum + plugin.enabledCount, 0)
  const toolCount = plugins.reduce((sum, plugin) => sum + plugin.toolCount, 0)

  return { plugins, enabledCount, toolCount }
}
