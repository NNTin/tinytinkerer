import type { InspectorResponseView, InspectorView } from '@tinytinkerer/contracts'
import { useState } from 'react'
import { ReadOnlyCodeView } from '@tinytinkerer/content-code'

// The inspector panel is lazy-loaded by ContextInspectorSlot (see
// context-inspector.tsx) so its code — and the heavier CodeMirror JSON view it
// pulls in via ReadOnlyCodeView — stays OUT of the eagerly-loaded chat route
// chunk and only loads when a developer actually opens the panel. Mirrors the
// LazyBrowserSettingsModal split. Keep imports here panel-only.

const formatTokens = (value: number): string => value.toLocaleString('en-US')

const RoleBadge = ({ view }: { view: { role: string; isSystem: boolean } }) => (
  <span
    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
      view.isSystem ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'
    }`}
  >
    {view.role}
  </span>
)

const formatUsage = (usage?: {
  completionTokens?: number
  totalTokens?: number
}): string | null => {
  if (!usage) return null
  const parts: string[] = []
  if (usage.completionTokens != null)
    parts.push(`${formatTokens(usage.completionTokens)} completion`)
  if (usage.totalTokens != null) parts.push(`${formatTokens(usage.totalTokens)} total`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// Renders the paired response outcome distinctly per status. A rate limit is
// highlighted with the note that no tokens were consumed; an error shows the
// status; an OK response shows the model's content and any completion/total usage.
const ResponseSection = ({ response }: { response: InspectorResponseView }) => {
  if (response.status === 'pending') {
    return (
      <p data-testid="context-inspector-response" className="text-xs italic text-[var(--muted)]">
        {response.label}
      </p>
    )
  }

  if (response.status === 'rate_limited') {
    return (
      <div
        data-testid="context-inspector-response"
        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      >
        <p className="font-medium">{response.label}</p>
        <p className="mt-0.5">{response.note}</p>
        {response.retryAfterMs != null ? (
          <p className="mt-0.5 text-amber-700">
            Retry after ≈ {Math.ceil(response.retryAfterMs / 1000)}s
          </p>
        ) : null}
      </div>
    )
  }

  if (response.status === 'error') {
    return (
      <div
        data-testid="context-inspector-response"
        className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800"
      >
        <p className="font-medium">{response.label}</p>
        {response.message ? <p className="mt-0.5 break-words">{response.message}</p> : null}
      </div>
    )
  }

  const usageLabel = formatUsage(response.usage)
  return (
    <div
      data-testid="context-inspector-response"
      className="rounded-lg border border-stone-200 bg-white"
    >
      <div className="flex items-center justify-between px-3 py-2 text-xs text-stone-500">
        <span className="font-medium text-stone-600">{response.label}</span>
        <span>
          ≈ {formatTokens(response.approxResponseTokens)} tok{usageLabel ? ` · ${usageLabel}` : ''}
        </span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-stone-100 px-3 py-2 text-xs text-stone-800">
        {response.content || '(empty response)'}
      </pre>
    </div>
  )
}

export type ContextInspectorPanelProps = {
  view: InspectorView
  requestCount: number
  selectedIndex: number
  onSelectIndex: (index: number) => void
  contextWindow: number | null
  onClose: () => void
}

export const ContextInspectorPanel = ({
  view,
  requestCount,
  selectedIndex,
  onSelectIndex,
  contextWindow,
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

  // Prefer the provider's real prompt-token count for THIS request (paired at the
  // chokepoint, so stepping through requests shows each one's own usage); fall back
  // to the char/4 estimate when usage wasn't reported (e.g. a rate-limited call).
  const realPromptTokens =
    view.response.status === 'ok' ? view.response.usage?.promptTokens : undefined
  const totalLabel =
    realPromptTokens != null
      ? `${formatTokens(realPromptTokens)} prompt tokens${
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
              The exact request and response — stays on this device.
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
          {view.tools && view.tools.length > 0 ? (
            <span data-testid="context-inspector-tools">
              Tools: <span className="font-mono text-stone-800">{view.tools.join(', ')}</span>
              {view.toolChoice ? (
                <span className="text-stone-500"> ({view.toolChoice})</span>
              ) : null}
            </span>
          ) : null}
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <span className="text-xs font-medium text-stone-600">Request</span>
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
            <span className="text-xs font-medium text-stone-600">Response</span>
            <ResponseSection response={view.response} />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-stone-600">Raw request payload</span>
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

export default ContextInspectorPanel
