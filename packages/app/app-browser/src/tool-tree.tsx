import { isPluginEnabled, isPluginToolEnabled } from '@tinytinkerer/app-core'
import type { ToolTreeInput, ToolTreeSummarizer } from '@tinytinkerer/contracts'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
// Icons come straight from react-icons (not @tinytinkerer/ui): app-browser must not
// depend on the ui package (see floating-chat-surface's boundary comment) — react-icons
// is the same source ui re-exports.
import { FaListCheck } from 'react-icons/fa6'
import { useBrowserApp, useSettingsStore } from './app'
import { appToolCatalogue } from './app-tool-group'
import { usePluginModules } from './plugins/use-plugin-modules'

// The panel is lazy-loaded so it stays out of the eagerly-loaded chat route chunk
// and only loads when a user actually opens the tool tree. Mirrors
// LazyContextInspectorPanel.
const LazyToolTreePanel = lazy(() =>
  import('./tool-tree-panel').then((module) => ({ default: module.ToolTreePanel }))
)

type ToolTreeData = {
  // The active enabled tool-tree plugin's pure mapper, or null when no tool-tree
  // plugin is enabled (slot stays hidden).
  summarizer: ToolTreeSummarizer | null
  // The host-built input: every ENABLED plugin with at least one declared tool
  // (issue #400 — a plugin with none has nothing to check), PLUS the app's own
  // tool group if it has any tools (issue #400 follow-up). Both are structurally
  // identical in the tree; they differ only in how a toggle persists (see
  // appGroupIds).
  input: ToolTreeInput
  // Full current tool id list per owner (plugin OR app group), keyed by id — what
  // setPluginToolSelection / setAppToolSelection need to normalize a selection
  // change. Mirrors `input` but keeps every declared tool id even if the input
  // above later changes shape.
  toolIdsByPlugin: Record<string, string[]>
  // Ids in the tree that are APP groups, not plugins (issue #400 follow-up). The
  // panel routes a toggle on one of these through setAppToolSelection (no
  // activation, stays visible when all-unchecked) instead of the plugin chokepoint.
  appGroupIds: string[]
}

// Resolve the active tool-tree plugin's mapper (first ENABLED plugin that
// contributes a toolTreeDescriptor wins) plus the host-built tree data. Mirrors
// useContextInspector: the plugin owns the input→view mapping; the host only
// supplies data and renders the result.
//
// `fallbackSummarizer` is an opt-in escape hatch for a host whose catalogue may
// not carry a tool-tree-descriptor plugin, or whose reader has switched it off.
// Such a host may still have a real `appToolGroup` worth picking tools from, so
// it can pass `genericToolTreeSummarizer` (this package's own product-agnostic
// mapper) to get a working tree either way.
//
// It used to say something stronger: that a Docusaurus/webpack build could never
// discover a plugin at all, because `import.meta.glob` had no equivalent there
// and plugin modules were always `[]`. Since issue #495 a host injects its own
// catalogue and the documentation apps carry `plugin-tool-tree`, so the plugin
// branch below is live in docs too — the fallback is now a real fallback rather
// than the only reachable path.
// Omitted (the default), this behaves exactly as before: `summarizer` stays
// `null` — and the slot stays hidden — until an enabled plugin contributes one.
export const useToolTree = (options?: {
  fallbackSummarizer?: ToolTreeSummarizer
}): ToolTreeData => {
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const pluginDisabledTools = useSettingsStore((state) => state.pluginDisabledTools)
  const appToolDisablement = useSettingsStore((state) => state.appToolDisablement)
  const pluginModules = usePluginModules()
  const app = useBrowserApp()
  const appToolGroup = app.appToolGroup
  // The app's own mapper is the fallback when a render site passes none (issue
  // #480 review, finding 1). Held on the app so a surface cannot silently ship
  // without a picker: `ToolTreeSlot` renders NOTHING without a summarizer, so
  // forgetting it looks exactly like "this app has no tools".
  const fallbackSummarizer = options?.fallbackSummarizer ?? app.toolTreeSummarizer ?? null

  const summarizer = useMemo<ToolTreeSummarizer | null>(() => {
    const active = pluginModules.find(
      (mod) => mod.manifest.toolTreeDescriptor && isPluginEnabled(pluginActivation, mod.manifest)
    )
    return active?.manifest.toolTreeDescriptor?.summarizeToolTree ?? fallbackSummarizer
  }, [pluginModules, pluginActivation, fallbackSummarizer])

  const { input, toolIdsByPlugin, appGroupIds } = useMemo(() => {
    const enabledToolPlugins = pluginModules.filter(
      (mod) =>
        isPluginEnabled(pluginActivation, mod.manifest) &&
        (mod.manifest.toolDescriptors?.length ?? 0) > 0
    )

    const pluginNodes = enabledToolPlugins.map((mod) => ({
      id: mod.manifest.id,
      label: mod.manifest.label,
      tools: (mod.manifest.toolDescriptors ?? []).map((tool) => ({
        id: tool.id,
        description: tool.description,
        enabled: isPluginToolEnabled(pluginDisabledTools, mod.manifest.id, tool.id)
      }))
    }))

    const ids: Record<string, string[]> = Object.fromEntries(
      enabledToolPlugins.map((mod) => [
        mod.manifest.id,
        (mod.manifest.toolDescriptors ?? []).map((tool) => tool.id)
      ])
    )

    // The app's own tool group (issue #400 follow-up) joins the tree as one more
    // node, always shown when it has ≥1 tool. Unlike a plugin it has no activation
    // gate — even with every tool disabled it stays visible (the app is intrinsic
    // to the shell), so it is added unconditionally here; the all-unchecked =
    // still-visible behavior falls out because its tools always exist.
    const appGroupIds: string[] = []
    // The catalogue, never a run's instances: this is the list the reader picks
    // from, and it is stable for the whole session even when the group builds its
    // tools per run (see app-tool-group.ts).
    const appTools = appToolGroup ? appToolCatalogue(appToolGroup) : []
    if (appToolGroup && appTools.length > 0) {
      pluginNodes.push({
        id: appToolGroup.id,
        label: appToolGroup.label,
        tools: appTools.map((tool) => ({
          id: tool.id,
          description: tool.description,
          enabled: isPluginToolEnabled(appToolDisablement, appToolGroup.id, tool.id)
        }))
      })
      ids[appToolGroup.id] = appTools.map((tool) => tool.id)
      appGroupIds.push(appToolGroup.id)
    }

    return { input: { plugins: pluginNodes }, toolIdsByPlugin: ids, appGroupIds }
  }, [pluginModules, pluginActivation, pluginDisabledTools, appToolGroup, appToolDisablement])

  return { summarizer, input, toolIdsByPlugin, appGroupIds }
}

// Convenience wrapper: a compose-area button that opens the tool tree, or renders
// nothing when no tool-tree plugin is enabled. UNLIKE ContextInspectorSlot, the
// button stays visible even when the resolved tree is empty (e.g. every tool
// plugin was just disabled from inside the open panel) — a vanishing button would
// be undiscoverable; the panel shows an empty state instead.
//
// `icon` and `className` are optional overrides; the default icon/style below make
// the slot fully self-contained so no host needs to supply a glyph.
export const ToolTreeSlot = ({
  className,
  icon = <FaListCheck className="h-4 w-4" aria-hidden="true" />,
  fallbackSummarizer
}: {
  className?: string
  icon?: ReactNode
  // See useToolTree's `fallbackSummarizer` — passed straight through so a host
  // that can never discover a tool-tree-descriptor plugin can still offer the
  // slot for its own `appToolGroup`.
  fallbackSummarizer?: ToolTreeSummarizer
}) => {
  const { summarizer, input, toolIdsByPlugin, appGroupIds } = useToolTree(
    fallbackSummarizer ? { fallbackSummarizer } : undefined
  )
  const [open, setOpen] = useState(false)

  const view = useMemo(() => (summarizer ? summarizer(input) : null), [summarizer, input])

  if (!summarizer) {
    return null
  }

  return (
    <>
      <button
        type="button"
        data-testid="tool-tree-toggle"
        aria-label="Choose available tools"
        title="Choose which tools are available to the assistant"
        onClick={() => setOpen(true)}
        className={
          className ??
          'flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 hover:text-stone-800'
        }
      >
        {icon}
      </button>
      {open && view ? (
        <Suspense fallback={null}>
          <LazyToolTreePanel
            view={view}
            toolIdsByPlugin={toolIdsByPlugin}
            appGroupIds={appGroupIds}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
