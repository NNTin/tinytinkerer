import type { ToolTreePluginNode, ToolTreeView } from '@tinytinkerer/contracts'
import { useSettingsStore } from './app'

// The tool-tree panel is lazy-loaded by ToolTreeSlot (see tool-tree.tsx) so its
// code stays OUT of the eagerly-loaded chat route chunk and only loads when a user
// actually opens the panel. Mirrors the ContextInspectorPanel split.

// A native checkbox whose `indeterminate` DOM property (not a JSX prop) is set via
// a ref callback for the plugin row's tri-state display.
const IndeterminateCheckbox = ({
  checked,
  indeterminate,
  onChange,
  testId,
  ariaLabel
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
  testId: string
  ariaLabel: string
}) => (
  <input
    type="checkbox"
    data-testid={testId}
    aria-label={ariaLabel}
    checked={checked}
    ref={(node) => {
      if (node) node.indeterminate = indeterminate
    }}
    onChange={onChange}
    className="h-4 w-4 shrink-0 accent-stone-700"
  />
)

export type ToolTreePanelProps = {
  view: ToolTreeView
  // Full current tool id list per plugin, keyed by plugin id — needed to build the
  // "uncheck everything" denylist for the plugin-level checkbox, since a checked
  // tree node only ever lists the tools it currently has (see useToolTree).
  toolIdsByPlugin: Record<string, string[]>
  onClose: () => void
}

export const ToolTreePanel = ({ view, toolIdsByPlugin, onClose }: ToolTreePanelProps) => {
  const setPluginToolSelection = useSettingsStore((state) => state.setPluginToolSelection)

  // The tool tree's own `checked` flags ARE the current denylist, inverted — no
  // need to re-read pluginDisabledTools from the store. Unchecking every tool of a
  // plugin disables that plugin (the app-core policy chokepoint,
  // applyPluginToolSelection), so the row simply disappears from `view` on the next
  // render — intended, per the issue.
  const toggleTool = (plugin: ToolTreePluginNode, toolId: string, nextChecked: boolean): void => {
    const currentDisabled = plugin.tools.filter((tool) => !tool.checked).map((tool) => tool.id)
    const nextDisabled = nextChecked
      ? currentDisabled.filter((id) => id !== toolId)
      : [...currentDisabled, toolId]
    void setPluginToolSelection(
      { id: plugin.id, toolIds: toolIdsByPlugin[plugin.id] ?? plugin.tools.map((t) => t.id) },
      nextDisabled
    )
  }

  const togglePlugin = (plugin: ToolTreePluginNode, nextChecked: boolean): void => {
    const toolIds = toolIdsByPlugin[plugin.id] ?? plugin.tools.map((t) => t.id)
    const nextDisabled = nextChecked ? [] : toolIds
    void setPluginToolSelection({ id: plugin.id, toolIds }, nextDisabled)
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close tool picker"
        className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose available tools"
        data-testid="tool-tree-panel"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-stone-900">Tools</h2>
            <p className="truncate text-xs text-[var(--muted)]">
              {view.enabledCount} of {view.toolCount} tools enabled
            </p>
          </div>
          <button
            type="button"
            aria-label="Close tool picker"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {view.plugins.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No enabled plugins contribute tools.</p>
          ) : (
            view.plugins.map((plugin) => (
              <div
                key={plugin.id}
                className="space-y-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2"
              >
                <label className="flex cursor-pointer items-center gap-2">
                  <IndeterminateCheckbox
                    checked={plugin.checked === 'all'}
                    indeterminate={plugin.checked === 'some'}
                    onChange={() => togglePlugin(plugin, plugin.checked !== 'all')}
                    testId={`tool-tree-plugin-${plugin.id}`}
                    ariaLabel={`Toggle all tools for ${plugin.label}`}
                  />
                  <span className="flex-1 text-sm font-medium text-stone-800">{plugin.label}</span>
                  <span className="shrink-0 text-xs text-stone-500">
                    {plugin.enabledCount} of {plugin.toolCount} tools
                  </span>
                </label>

                <div className="ml-6 space-y-1">
                  {plugin.tools.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-stone-50"
                    >
                      <IndeterminateCheckbox
                        checked={tool.checked}
                        indeterminate={false}
                        onChange={() => toggleTool(plugin, tool.id, !tool.checked)}
                        testId={`tool-tree-tool-${tool.id}`}
                        ariaLabel={tool.id}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs text-stone-800">
                          {tool.id}
                        </span>
                        <span className="block truncate text-xs text-stone-500">
                          {tool.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default ToolTreePanel
