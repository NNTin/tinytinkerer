import { isPluginEnabled } from '@tinytinkerer/app-core'
import type { InspectorEntry, InspectorSummarizer } from '@tinytinkerer/contracts'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useInspectorStore, useSettingsStore } from './app'
import { useModels } from './models'
import { usePluginModules } from './plugins/use-plugin-modules'

// The panel (and the heavier CodeMirror JSON view it pulls in) is lazy-loaded so
// it stays out of the eagerly-loaded chat route chunk and only loads when a
// developer opens the inspector. Mirrors LazyBrowserSettingsModal.
const LazyContextInspectorPanel = lazy(() =>
  import('./context-inspector-panel').then((module) => ({
    default: module.ContextInspectorPanel
  }))
)

type ContextInspectorData = {
  // The active enabled inspector plugin's pure mapper, or null when no inspector
  // plugin is enabled (panel stays hidden).
  summarizer: InspectorSummarizer | null
  // Captured request+response entries, oldest → newest (ring-buffered host store).
  entries: InspectorEntry[]
  // The selected model's input context window, when known (#264 data).
  contextWindow: number | null
}

// Resolve the active inspector plugin's mapper (first enabled plugin that
// contributes an inspectorDescriptor wins) plus the host data the panel overlays.
// Mirrors useContextGauge: the plugin owns the entry→view mapping; the host only
// supplies data and renders the result.
export const useContextInspector = (): ContextInspectorData => {
  const entries = useInspectorStore((state) => state.entries)
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const { models } = useModels(selectedModel)

  const pluginModules = usePluginModules()
  const summarizer = useMemo<InspectorSummarizer | null>(() => {
    const active = pluginModules.find(
      (mod) => mod.manifest.inspectorDescriptor && isPluginEnabled(pluginActivation, mod.manifest)
    )
    return active?.manifest.inspectorDescriptor?.summarizeRequest ?? null
  }, [pluginModules, pluginActivation])

  const contextWindow =
    models.find((model) => model.id === selectedModel)?.limits?.max_input_tokens ?? null

  return { summarizer, entries, contextWindow }
}

// Convenience wrapper: a small developer button that opens the context inspector,
// or renders nothing when no inspector plugin is enabled or nothing has been
// captured yet. Drop it next to the composer (web app only). Mirrors
// ContextGaugeSlot's "resolve view-model, render or hide" shape.
//
// `icon` lets the host supply a glyph (the web app passes its FaReceipt from the
// UI package, which app-browser cannot import directly). When omitted the button
// falls back to a plain "Context" text label so the slot still works standalone.
export const ContextInspectorSlot = ({
  className,
  icon
}: {
  className?: string
  icon?: ReactNode
}) => {
  const { summarizer, entries, contextWindow } = useContextInspector()
  const [open, setOpen] = useState(false)
  // null = follow the latest request; a number pins a specific one in the stepper.
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)

  const selectedIndex = useMemo(() => {
    if (entries.length === 0) return 0
    if (pinnedIndex == null) return entries.length - 1
    return Math.min(Math.max(pinnedIndex, 0), entries.length - 1)
  }, [pinnedIndex, entries.length])

  const view = useMemo(() => {
    if (!summarizer) return null
    const entry = entries[selectedIndex]
    return entry ? summarizer(entry) : null
  }, [summarizer, entries, selectedIndex])

  if (!summarizer || entries.length === 0) {
    return null
  }

  return (
    <>
      <button
        type="button"
        data-testid="context-inspector-toggle"
        aria-label="Open context inspector"
        title="Inspect the exact context sent to the model"
        onClick={() => setOpen(true)}
        className={
          className ??
          (icon
            ? 'flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50 hover:text-stone-800'
            : 'inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50')
        }
      >
        {icon ?? 'Context'}
      </button>
      {open && view ? (
        <Suspense fallback={null}>
          <LazyContextInspectorPanel
            view={view}
            requestCount={entries.length}
            selectedIndex={selectedIndex}
            onSelectIndex={setPinnedIndex}
            contextWindow={contextWindow}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      ) : null}
    </>
  )
}
