import { isPluginEnabled } from '@tinytinkerer/app-core'
import type {
  ChatEvent,
  InspectorRequestPayload,
  InspectorSummarizer,
  InspectorView
} from '@tinytinkerer/contracts'
import { useEffect, useMemo, useState } from 'react'
import { ReadOnlyCodeView } from '@tinytinkerer/content-code'
import { useChatStore, useInspectorStore, useSettingsStore } from './app'
import { useModels } from './models'
import { loadPluginModules } from './plugins/registry'

// Most recent provider-reported prompt-token count — the authoritative total the
// inspector shows alongside its rough per-message estimate. Same "latest
// agent.usage" semantics the context-usage gauge uses (#264); returns null until
// the provider reports usage.
const latestPromptTokens = (events: ChatEvent[]): number | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'agent.usage') {
      return event.payload.promptTokens
    }
  }
  return null
}

const formatTokens = (value: number): string => value.toLocaleString('en-US')

type ContextInspectorData = {
  // The active enabled inspector plugin's pure mapper, or null when no inspector
  // plugin is enabled (panel stays hidden).
  summarizer: InspectorSummarizer | null
  // Captured forwarded requests, oldest → newest (ring-buffered host store).
  requests: InspectorRequestPayload[]
  // The selected model's input context window, when known (#264 data).
  contextWindow: number | null
  // The provider's latest reported prompt-token total, when observed.
  promptTokens: number | null
}

// Resolve the active inspector plugin's mapper (first enabled plugin that
// contributes an inspectorDescriptor wins) plus the host data the panel overlays.
// Mirrors useContextGauge: the plugin owns the payload→view mapping; the host only
// supplies data and renders the result.
export const useContextInspector = (): ContextInspectorData => {
  const requests = useInspectorStore((state) => state.requests)
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const events = useChatStore((state) => state.events)
  const { models } = useModels(selectedModel)

  const [summarizer, setSummarizer] = useState<InspectorSummarizer | null>(null)
  useEffect(() => {
    let cancelled = false
    void loadPluginModules().then((modules) => {
      if (cancelled) return
      const active = modules.find(
        (mod) => mod.manifest.inspectorDescriptor && isPluginEnabled(pluginActivation, mod.manifest)
      )
      setSummarizer(() => active?.manifest.inspectorDescriptor?.summarizeRequest ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [pluginActivation])

  const contextWindow =
    models.find((model) => model.id === selectedModel)?.limits?.max_input_tokens ?? null

  return { summarizer, requests, contextWindow, promptTokens: latestPromptTokens(events) }
}

const RoleBadge = ({ view }: { view: { role: string; isSystem: boolean } }) => (
  <span
    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      view.isSystem ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'
    }`}
  >
    {view.role}
  </span>
)

type ContextInspectorPanelProps = {
  view: InspectorView
  requestCount: number
  selectedIndex: number
  onSelectIndex: (index: number) => void
  contextWindow: number | null
  promptTokens: number | null
  onClose: () => void
}

const ContextInspectorPanel = ({
  view,
  requestCount,
  selectedIndex,
  onSelectIndex,
  contextWindow,
  promptTokens,
  onClose
}: ContextInspectorPanelProps) => {
  const [copied, setCopied] = useState(false)

  const copyPayload = async (): Promise<void> => {
    try {
      await navigator.clipboard?.writeText(view.rawJson)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be denied; the JSON view is still readable/selectable.
    }
  }

  const totalLabel =
    promptTokens != null
      ? `${formatTokens(promptTokens)} prompt tokens${
          contextWindow != null ? ` / ${formatTokens(contextWindow)} context` : ''
        }`
      : `≈ ${formatTokens(view.approxTotalTokens)} tokens (estimate)`

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close context inspector"
        className="absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Context inspector"
        data-testid="context-inspector-panel"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-stone-900">Context inspector</h2>
            <p className="truncate text-xs text-[var(--muted)]">
              The exact request sent to the model — stays on this device.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close context inspector"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--border)] px-5 py-2 text-xs text-stone-600">
          <span>
            Model: <span className="font-medium text-stone-800">{view.model}</span>
          </span>
          {view.area ? (
            <span>
              Phase: <span className="font-medium text-stone-800">{view.area}</span>
            </span>
          ) : null}
          <span>
            Stream options: <span className="font-mono text-stone-800">{view.streamOptions}</span>
          </span>
          <span data-testid="context-inspector-tokens">{totalLabel}</span>
          <span>{view.messageCount} messages</span>
        </div>

        {requestCount > 1 ? (
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-2 text-xs">
            <button
              type="button"
              aria-label="Previous request"
              disabled={selectedIndex <= 0}
              onClick={() => onSelectIndex(selectedIndex - 1)}
              className="rounded border border-stone-200 px-2 py-0.5 text-stone-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ‹
            </button>
            <span className="text-stone-600">
              Request {selectedIndex + 1} of {requestCount}
            </span>
            <button
              type="button"
              aria-label="Next request"
              disabled={selectedIndex >= requestCount - 1}
              onClick={() => onSelectIndex(selectedIndex + 1)}
              className="rounded border border-stone-200 px-2 py-0.5 text-stone-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ›
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            {view.messages.map((message) => (
              <details
                key={message.index}
                data-testid="context-inspector-message"
                className="rounded-lg border border-stone-200 bg-white"
                open={message.isSystem}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs text-stone-600">
                  <span className="flex items-center gap-2">
                    <RoleBadge view={message} />
                    <span className="text-stone-400">#{message.index}</span>
                  </span>
                  <span className="text-stone-400">≈ {formatTokens(message.approxTokens)} tok</span>
                </summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-stone-100 px-3 py-2 text-xs text-stone-800">
                  {message.content}
                </pre>
              </details>
            ))}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600">Raw payload</span>
              <button
                type="button"
                onClick={() => void copyPayload()}
                className="rounded border border-stone-200 px-2 py-0.5 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <ReadOnlyCodeView
              value={view.rawJson}
              language="json"
              className="tt-code-editor max-h-72 overflow-auto rounded-lg border border-stone-200"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Convenience wrapper: a small developer button that opens the context inspector,
// or renders nothing when no inspector plugin is enabled or nothing has been
// captured yet. Drop it next to the composer (web app only). Mirrors
// ContextGaugeSlot's "resolve view-model, render or hide" shape.
export const ContextInspectorSlot = ({ className }: { className?: string }) => {
  const { summarizer, requests, contextWindow, promptTokens } = useContextInspector()
  const [open, setOpen] = useState(false)
  // null = follow the latest request; a number pins a specific one in the stepper.
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null)

  const selectedIndex = useMemo(() => {
    if (requests.length === 0) return 0
    if (pinnedIndex == null) return requests.length - 1
    return Math.min(Math.max(pinnedIndex, 0), requests.length - 1)
  }, [pinnedIndex, requests.length])

  const view = useMemo(() => {
    if (!summarizer) return null
    const payload = requests[selectedIndex]
    return payload ? summarizer(payload) : null
  }, [summarizer, requests, selectedIndex])

  if (!summarizer || requests.length === 0) {
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
          'inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50'
        }
      >
        Context
      </button>
      {open && view ? (
        <ContextInspectorPanel
          view={view}
          requestCount={requests.length}
          selectedIndex={selectedIndex}
          onSelectIndex={setPinnedIndex}
          contextWindow={contextWindow}
          promptTokens={promptTokens}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}
