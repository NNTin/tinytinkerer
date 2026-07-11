import { isPluginEnabled, isPluginToolEnabled } from '@tinytinkerer/app-core'
import type { ToolTreeInput, ToolTreeSummarizer } from '@tinytinkerer/contracts'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
// Icons come straight from react-icons (not @tinytinkerer/ui): app-browser must not
// depend on the ui package (see floating-chat-surface's boundary comment) — react-icons
// is the same source ui re-exports.
import { FaListCheck } from 'react-icons/fa6'
import { useSettingsStore } from './app'
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
  // (issue #400 — a plugin with none has nothing to check).
  input: ToolTreeInput
  // Full current tool id list per plugin, keyed by plugin id — what
  // setPluginToolSelection needs to normalize a selection change. Mirrors `input`
  // but keeps every declared tool id even if the input above later changes shape.
  toolIdsByPlugin: Record<string, string[]>
}

// Resolve the active tool-tree plugin's mapper (first ENABLED plugin that
// contributes a toolTreeDescriptor wins) plus the host-built tree data. Mirrors
// useContextInspector: the plugin owns the input→view mapping; the host only
// supplies data and renders the result.
export const useToolTree = (): ToolTreeData => {
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const pluginDisabledTools = useSettingsStore((state) => state.pluginDisabledTools)
  const pluginModules = usePluginModules()

  const summarizer = useMemo<ToolTreeSummarizer | null>(() => {
    const active = pluginModules.find(
      (mod) => mod.manifest.toolTreeDescriptor && isPluginEnabled(pluginActivation, mod.manifest)
    )
    return active?.manifest.toolTreeDescriptor?.summarizeToolTree ?? null
  }, [pluginModules, pluginActivation])

  const { input, toolIdsByPlugin } = useMemo(() => {
    const enabledToolPlugins = pluginModules.filter(
      (mod) =>
        isPluginEnabled(pluginActivation, mod.manifest) &&
        (mod.manifest.toolDescriptors?.length ?? 0) > 0
    )

    const plugins = enabledToolPlugins.map((mod) => ({
      id: mod.manifest.id,
      label: mod.manifest.label,
      tools: (mod.manifest.toolDescriptors ?? []).map((tool) => ({
        id: tool.id,
        description: tool.description,
        enabled: isPluginToolEnabled(pluginDisabledTools, mod.manifest.id, tool.id)
      }))
    }))

    const ids = Object.fromEntries(
      enabledToolPlugins.map((mod) => [
        mod.manifest.id,
        (mod.manifest.toolDescriptors ?? []).map((tool) => tool.id)
      ])
    )

    return { input: { plugins }, toolIdsByPlugin: ids }
  }, [pluginModules, pluginActivation, pluginDisabledTools])

  return { summarizer, input, toolIdsByPlugin }
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
  icon = <FaListCheck className="h-4 w-4" aria-hidden="true" />
}: {
  className?: string
  icon?: ReactNode
}) => {
  const { summarizer, input, toolIdsByPlugin } = useToolTree()
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
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
