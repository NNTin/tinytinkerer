import type {
  ActivitySummarizer,
  ActivityView,
  TurnActivity,
  TurnActivityItem
} from '@tinytinkerer/app-core'
import { useEffect, useState } from 'react'

// Resolves the activity summarizer a tool's owner provides, keyed by tool id, or
// `undefined` for tools that ship none (the host then uses a neutral default).
// The host builds this so the panel itself carries zero tool-specific knowledge.
export type ResolveActivitySummarizer = (toolId: string) => ActivitySummarizer | undefined

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

// Neutral, tool-agnostic label. Formats the MCP `mcp:<server>:<tool>` id using the
// user's server-name map (host-owned settings data, not tool-output knowledge);
// every other tool id is shown verbatim. Used for the started/failed rows and as
// the fallback heading for a completed tool whose owner provides no summarizer.
export const toolLabel = (toolId: string, serverNameById: Map<string, string>): string => {
  const mcpMatch = toolId.match(/^mcp:([^:]+):(.+)$/)
  if (mcpMatch) {
    const [, serverId, toolName] = mcpMatch
    const serverName = serverNameById.get(serverId ?? '')
    return serverName ? `[${serverName}] ${toolName}` : (toolName ?? toolId)
  }
  return toolId
}

type ToolItem = Extract<TurnActivityItem, { kind: 'tool' }>

// True when a completed tool produced nothing worth summarizing: no output, an
// empty object, or an empty string. Only then does the neutral default show
// "(no output)" — a successful run with real output never does.
const isEmptyOutput = (output: unknown): boolean =>
  output == null ||
  (typeof output === 'string' && output.length === 0) ||
  (typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length === 0)

// The host's neutral default for a completed tool whose owner ships no summarizer.
// It cannot assume any output shape, so it only names the tool and, when there is
// genuinely no output, says so; otherwise it leaves the dropdown body empty (the
// real result is delivered to the model and rendered separately).
const neutralView = (label: string, output: unknown): ActivityView => ({
  title: label,
  sections: isEmptyOutput(output) ? [{ label: '', value: '(no output)' }] : []
})

const statusStyles: Record<'ok' | 'error' | 'warn', { border: string; summary: string; body: string }> = {
  ok: {
    border: 'border-stone-200/70 bg-white/60',
    summary: 'text-stone-600',
    body: 'border-stone-100 text-[var(--muted)]'
  },
  error: {
    border: 'border-rose-200 bg-rose-50/70',
    summary: 'text-rose-700',
    body: 'border-rose-100 text-rose-700'
  },
  warn: {
    border: 'border-amber-200 bg-amber-50/70',
    summary: 'text-amber-800',
    body: 'border-amber-100 text-amber-800'
  }
}

// One generic renderer for every completed tool. It is driven entirely by the
// resolved ActivityView and never branches on a tool id — each tool's owner (a
// plugin, or the MCP layer) decides title/status/sections. Values are rendered as
// plain text; tool output is untrusted and never injected as HTML.
const ActivityViewEntry = ({ view }: { view: ActivityView }) => {
  const styles = statusStyles[view.status ?? 'ok']
  return (
    <details className={`group rounded-md border text-xs ${styles.border}`}>
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 hover:bg-stone-50/80 ${styles.summary}`}
      >
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-stone-100 text-[9px] font-bold text-stone-400 transition-transform group-open:rotate-90">
          ▶
        </span>
        <span>{view.title}</span>
      </summary>
      <div className={`space-y-0.5 border-t px-3 py-1.5 ${styles.body}`}>
        {view.sections.map((section, index) => (
          <div key={`${section.label}-${index}`}>
            {section.label ? (
              <span className="text-[var(--muted)]">{section.label}: </span>
            ) : null}
            <span className="text-stone-600">{section.value}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

const ToolEntry = ({
  item,
  serverNameById,
  resolveSummarizer
}: {
  item: ToolItem
  serverNameById: Map<string, string>
  resolveSummarizer: ResolveActivitySummarizer
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

  const summarizer = resolveSummarizer(item.toolId)
  const view = summarizer ? summarizer(item.output) : neutralView(label, item.output)
  return <ActivityViewEntry view={view} />
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
  serverNameById,
  resolveSummarizer = () => undefined
}: {
  activity: TurnActivity
  isLive: boolean
  serverNameById: Map<string, string>
  // Resolves a tool's owner-provided activity summarizer by id. Defaults to "no
  // summarizer" so callers (and tests) that don't wire it get the neutral default.
  resolveSummarizer?: ResolveActivitySummarizer
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
                        <ToolEntry
                          item={item}
                          serverNameById={serverNameById}
                          resolveSummarizer={resolveSummarizer}
                        />
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
