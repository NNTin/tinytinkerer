import type { ToolTreePluginNode, ToolTreeView } from '@tinytinkerer/contracts'
import { retryHostMcpDiscovery, useHostMcp, useOptionalBrowserApp, useSettingsStore } from './app'
import { hostMcpServerStatus, type HostMcpServerStatus } from './stores/host-mcp-store'

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
    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
  />
)

const hostServerStatusText = (status: HostMcpServerStatus): string => {
  switch (status.state) {
    case 'syncing':
      return 'Connecting…'
    case 'signed-out':
      return 'Sign in to load its tools'
    case 'available':
      return `${status.toolCount} tool${status.toolCount !== 1 ? 's' : ''}, always on`
    case 'unavailable':
      return `Unavailable: ${status.error}`
  }
}

// The app's own MCP servers (issue #518, F5). Their tools cannot be toggled —
// the app provides them to every user — but they are listed so a server that is
// down reads as "unavailable" rather than silently missing from the picker.
const HostMcpServerRows = () => {
  const servers = useHostMcp((state) => state.servers)
  const discovery = useHostMcp((state) => state.discovery)
  const syncing = useHostMcp((state) => state.syncing)
  const app = useOptionalBrowserApp()
  if (servers.length === 0) return null
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2">
      <p className="text-sm font-medium text-[var(--text-strong)]">Provided by this app</p>
      <ul className="space-y-1">
        {servers.map((server) => {
          const status = hostMcpServerStatus({ discovery, syncing }, server.id)
          const unavailable = status.state === 'unavailable'
          return (
            <li
              key={server.id}
              data-testid={`tool-tree-host-server-${server.id}`}
              data-status={status.state}
              className="flex items-start justify-between gap-2 px-1 py-0.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs text-[var(--text-strong)]">
                  {server.name}
                </span>
                <span
                  className={`block whitespace-normal break-words text-xs ${unavailable ? 'text-rose-600' : 'text-[var(--muted)]'}`}
                >
                  {hostServerStatusText(status)}
                </span>
              </span>
              {unavailable && app ? (
                <button
                  type="button"
                  onClick={() => void retryHostMcpDiscovery(app)}
                  aria-label={`Retry ${server.name}`}
                  className="shrink-0 rounded px-2 py-0.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--text-strong)]"
                >
                  Retry
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export type ToolTreePanelProps = {
  view: ToolTreeView
  // Full current tool id list per owner (plugin or app group), keyed by id (see
  // useToolTree) — the POLICY source of truth for every toggle below, deliberately
  // independent of `view`: `view` is a summarizer's presentation of the same data
  // and may be lossy (filter/reorder), so building a denylist from it could
  // silently corrupt tool ids the summarizer chose not to render.
  toolIdsByPlugin: Record<string, string[]>
  // Ids in `view` that are APP groups rather than plugins (issue #400 follow-up).
  // A toggle on one of these routes through setAppToolSelection — no activation
  // flip, and the group stays visible when every tool is unchecked. Defaults to
  // none, so a tree of only plugins behaves exactly as before.
  appGroupIds?: string[]
  onClose: () => void
}

export const ToolTreePanel = ({
  view,
  toolIdsByPlugin,
  appGroupIds = [],
  onClose
}: ToolTreePanelProps) => {
  const setPluginToolSelection = useSettingsStore((state) => state.setPluginToolSelection)
  const setAppToolSelection = useSettingsStore((state) => state.setAppToolSelection)
  const pluginDisabledTools = useSettingsStore((state) => state.pluginDisabledTools)
  const appToolDisablement = useSettingsStore((state) => state.appToolDisablement)

  // Resolve which persistence path a row uses. An app group's disablement lives in
  // its own denylist (appToolDisablement) and never touches activation, so
  // disabling every tool keeps the group in the tree; a plugin routes through the
  // activation-coupled chokepoint (applyPluginToolSelection). `disabled` is the
  // group's/plugin's CURRENT denylist, read from HOST STATE — never from `view`,
  // which is DISPLAY-ONLY (issue #400 review, F3) and may be lossy.
  const ownerPolicy = (id: string) => {
    const isAppGroup = appGroupIds.includes(id)
    const denylist = isAppGroup ? (appToolDisablement ?? {}) : pluginDisabledTools
    const toolIds = toolIdsByPlugin[id] ?? []
    const disabled = toolIds.filter((toolId) => denylist[id]?.includes(toolId) ?? false)
    const apply = (nextDisabled: string[]): void => {
      if (isAppGroup) {
        void setAppToolSelection({ id, toolIds }, nextDisabled)
      } else {
        void setPluginToolSelection({ id, toolIds }, nextDisabled)
      }
    }
    return { toolIds, disabled, apply }
  }

  const toggleTool = (plugin: ToolTreePluginNode, toolId: string, nextChecked: boolean): void => {
    const { disabled, apply } = ownerPolicy(plugin.id)
    const nextDisabled = nextChecked
      ? disabled.filter((id) => id !== toolId)
      : [...disabled, toolId]
    apply(nextDisabled)
  }

  const togglePlugin = (plugin: ToolTreePluginNode, nextChecked: boolean): void => {
    // toolIdsByPlugin lacking the owner is a host bug, not something to paper over
    // with a view-derived fallback: an empty array is a no-op at both chokepoints,
    // which is the correct failure mode — do nothing rather than guess at tool ids
    // from the (possibly lossy) view.
    const { toolIds, apply } = ownerPolicy(plugin.id)
    apply(nextChecked ? [] : toolIds)
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
            <h2 className="text-sm font-semibold text-[var(--text-strong)]">Tools</h2>
            <p className="truncate text-xs text-[var(--muted)]">
              {view.enabledCount} of {view.toolCount} tools enabled
            </p>
            {/* The runtime is rebuilt per chat run (issue #400 review, F5/F9): a
                selection change here takes effect on the NEXT prompt, not the one
                already in flight — see create-runtime.ts / chat-store. */}
            <p className="truncate text-xs text-[var(--muted)]">
              Changes apply from your next message.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close tool picker"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--panel-hover)] hover:text-[var(--text-strong)]"
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
                className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2"
              >
                <label className="flex cursor-pointer items-center gap-2">
                  <IndeterminateCheckbox
                    checked={plugin.checked === 'all'}
                    indeterminate={plugin.checked === 'some'}
                    onChange={() => togglePlugin(plugin, plugin.checked !== 'all')}
                    testId={`tool-tree-plugin-${plugin.id}`}
                    ariaLabel={`Toggle all tools for ${plugin.label}`}
                  />
                  <span className="flex-1 text-sm font-medium text-[var(--text-strong)]">
                    {plugin.label}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--muted)]">
                    {plugin.enabledCount} of {plugin.toolCount} tools
                  </span>
                </label>

                <div className="ml-6 space-y-1">
                  {plugin.tools.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-[var(--panel-hover)]"
                    >
                      <IndeterminateCheckbox
                        checked={tool.checked}
                        indeterminate={false}
                        onChange={() => toggleTool(plugin, tool.id, !tool.checked)}
                        testId={`tool-tree-tool-${tool.id}`}
                        ariaLabel={tool.id}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs text-[var(--text-strong)]">
                          {tool.id}
                        </span>
                        {/* Full description, wrapping to as many lines as needed —
                            never truncated (issue #400 follow-up). break-words so a
                            long unbroken token still wraps instead of overflowing. */}
                        <span className="block whitespace-normal break-words text-xs text-[var(--muted)]">
                          {tool.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
          <HostMcpServerRows />
        </div>
      </div>
    </div>
  )
}

export default ToolTreePanel
