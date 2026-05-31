import type { TurnActivity, TurnActivityItem } from '@tinytinkerer/app-core'
import { useEffect, useState } from 'react'

// Mirrors @tinytinkerer/ui ThinkingDots without taking a UI-package dependency
// here (app-browser stays free of the UI lib, like the local ToggleRow). The
// `thinking-dot` animation class is provided globally by the host app CSS.
const ThinkingDots = () => (
  <span aria-label="Thinking" className="inline-flex items-end gap-0.5 pb-0.5">
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-stone-400" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-stone-400" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-stone-400" />
  </span>
)

export const toolLabel = (toolId: string, serverNameById: Map<string, string>): string => {
  if (toolId === 'web-search') return 'Web search'
  const mcpMatch = toolId.match(/^mcp:([^:]+):(.+)$/)
  if (mcpMatch) {
    const [, serverId, toolName] = mcpMatch
    const serverName = serverNameById.get(serverId ?? '')
    return serverName ? `[${serverName}] ${toolName}` : (toolName ?? toolId)
  }
  return toolId
}

type ToolItem = Extract<TurnActivityItem, { kind: 'tool' }>

const ToolEntry = ({
  item,
  serverNameById
}: {
  item: ToolItem
  serverNameById: Map<string, string>
}) => {
  const label = toolLabel(item.toolId, serverNameById)

  if (item.status === 'failed') {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
        <span className="font-medium">{label} failed:</span> {item.error ?? 'unknown error'}
      </div>
    )
  }

  if (item.status === 'started') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-stone-200/70 bg-white/60 px-3 py-1.5 text-xs text-stone-600">
        <span>{label}</span>
        <ThinkingDots />
      </div>
    )
  }

  if (item.toolId === 'web-search') {
    const output = (item.output ?? {}) as { query?: string; results?: unknown[] }
    const resultCount = Array.isArray(output.results) ? output.results.length : 0
    return (
      <details className="group rounded-md border border-stone-200/70 bg-white/60 text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-stone-600 hover:bg-stone-50/80">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-stone-100 text-[9px] font-bold text-stone-400 transition-transform group-open:rotate-90">
            ▶
          </span>
          <span>
            Web search —{' '}
            <span className="text-[var(--muted)]">
              {resultCount} result{resultCount !== 1 ? 's' : ''}
            </span>
          </span>
        </summary>
        <div className="border-t border-stone-100 px-3 py-1.5 text-[var(--muted)]">
          Query: <span className="text-stone-600">{output.query ?? 'unknown'}</span>
        </div>
      </details>
    )
  }

  const mcpOutput = item.output as { text?: string; isError?: boolean } | undefined
  const isMcpError = mcpOutput?.isError === true
  const summaryText = mcpOutput?.text ? mcpOutput.text.slice(0, 120) : '(no output)'
  const summary = isMcpError ? `Error: ${summaryText}` : summaryText
  return (
    <details
      className={`group rounded-md border text-xs ${isMcpError ? 'border-rose-200 bg-rose-50/70' : 'border-stone-200/70 bg-white/60'}`}
    >
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 hover:bg-stone-50/80 ${isMcpError ? 'text-rose-700' : 'text-stone-600'}`}
      >
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-stone-100 text-[9px] font-bold text-stone-400 transition-transform group-open:rotate-90">
          ▶
        </span>
        <span>{label}</span>
      </summary>
      <div
        className={`border-t px-3 py-1.5 ${isMcpError ? 'border-rose-100 text-rose-700' : 'border-stone-100 text-[var(--muted)]'}`}
      >
        {summary}
      </div>
    </details>
  )
}

// Maps each step's own id to its parent id, learned only from "started" step
// labels (which carry stepKind). Observation labels and tools reference these
// ids but do not define the hierarchy themselves.
const buildParentByStep = (items: TurnActivityItem[]): Map<string, string | undefined> => {
  const map = new Map<string, string | undefined>()
  for (const item of items) {
    if (item.kind === 'label' && item.stepKind && item.stepId) {
      map.set(item.stepId, item.parentId)
    }
  }
  return map
}

const stepDepth = (
  parentByStep: Map<string, string | undefined>,
  stepId: string | undefined
): number => {
  let depth = 0
  let current = stepId
  const seen = new Set<string>()
  while (current && !seen.has(current) && parentByStep.get(current)) {
    seen.add(current)
    current = parentByStep.get(current)
    depth += 1
  }
  return depth
}

const itemDepth = (
  parentByStep: Map<string, string | undefined>,
  item: Exclude<TurnActivityItem, { kind: 'reasoning' }>
): number => {
  if (item.kind === 'tool') {
    return item.parentId ? stepDepth(parentByStep, item.parentId) + 1 : 0
  }
  return stepDepth(parentByStep, item.stepId)
}

// Inline, per-turn reasoning & activity. Auto-expands while the turn is live
// (streaming/running) and collapses once complete; the user can toggle at any
// time. Renders the model's raw chain-of-thought (when emitted) followed by the
// chronological planning/tool activity — visually separated above the answer.
export const TurnActivityPanel = ({
  activity,
  isLive,
  serverNameById
}: {
  activity: TurnActivity
  isLive: boolean
  serverNameById: Map<string, string>
}) => {
  const [open, setOpen] = useState(isLive)

  // Auto-expand when the turn starts running and auto-collapse when it finishes.
  // Manual toggles between these transitions are preserved (effect only fires on
  // isLive change).
  useEffect(() => {
    setOpen(isLive)
  }, [isLive])

  const hasReasoning = activity.reasoningText.trim().length > 0
  const activityItems = activity.items.filter(
    (item): item is Exclude<TurnActivityItem, { kind: 'reasoning' }> => item.kind !== 'reasoning'
  )
  const parentByStep = buildParentByStep(activity.items)

  // Nothing to show for a completed turn that produced no reasoning/activity.
  if (!isLive && !hasReasoning && activityItems.length === 0) {
    return null
  }

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          Reasoning &amp; activity
          {isLive ? <ThinkingDots /> : null}
        </h3>
        <button
          type="button"
          aria-label="Toggle reasoning and activity"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="text-xs text-[var(--muted)] transition-colors hover:text-stone-700"
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {open ? (
        <div className="mt-2 space-y-2">
          {hasReasoning ? (
            <div className="rounded-md border border-stone-200/70 bg-white/60 px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Reasoning
              </p>
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-stone-600">
                {activity.reasoningText}
              </p>
            </div>
          ) : null}

          {activityItems.length > 0 ? (
            <div className="space-y-1">
              {activityItems.map((item) => {
                const depth = Math.min(itemDepth(parentByStep, item), 4)
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-1.5"
                    style={depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined}
                  >
                    <span
                      aria-hidden
                      className="mt-1 shrink-0 select-none font-mono text-[10px] leading-none text-stone-300"
                    >
                      {depth > 0 ? '└─' : '•'}
                    </span>
                    <div className="min-w-0 flex-1">
                      {item.kind === 'tool' ? (
                        <ToolEntry item={item} serverNameById={serverNameById} />
                      ) : (
                        <span
                          className={
                            item.stepKind === 'think'
                              ? 'font-mono text-xs italic text-stone-500'
                              : 'text-xs text-stone-600'
                          }
                        >
                          {item.label}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : !hasReasoning && isLive ? (
            <p className="text-xs text-[var(--muted)]">
              Understanding request <ThinkingDots />
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
