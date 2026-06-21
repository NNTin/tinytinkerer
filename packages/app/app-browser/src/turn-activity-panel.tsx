import type {
  ActivitySummarizer,
  ActivityView,
  TurnActivity,
  TurnActivityItem
} from '@tinytinkerer/app-core'
import type { ReActDecisionKind } from '@tinytinkerer/contracts'
import { ReadOnlyCodeView } from '@tinytinkerer/content-code'
import { useEffect, useMemo, useState } from 'react'
import { forwardPluginReport } from './telemetry/plugin-report'

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
type LabelItem = Extract<TurnActivityItem, { kind: 'label' }>

// Action vs final colour + a non-colour cue. Colour alone never carries the
// distinction (WCAG 1.4.1, mirroring the context-usage gauge's colour+shape): a
// glyph (▶ / ✓) and the spelled-out word are always shown alongside it. Reuses
// the panel's tone palette so the badge reads as part of the same surface.
const decisionStyles: Record<ReActDecisionKind, { badge: string; icon: string; label: string }> = {
  action: {
    badge: 'border-sky-300 bg-sky-50 text-sky-700',
    icon: '▶',
    label: 'Action'
  },
  final: {
    badge: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    icon: '✓',
    label: 'Final'
  }
}

// One reasoning/activity label row. A ReAct `think` step renders its streamed
// chain-of-thought (italic) and, once its decision resolves, a colour+glyph+word
// badge for the decision kind plus the model's structured reasoning ("why").
// Both decision parts are optional: a step with no resolved decision (or a model
// that omitted `reasoning`) simply shows the thought, degrading gracefully.
const LabelEntry = ({ item }: { item: LabelItem }) => {
  if (item.stepKind !== 'think') {
    return <span className="text-xs text-stone-600">{item.label}</span>
  }

  const decision = item.decisionKind ? decisionStyles[item.decisionKind] : undefined
  return (
    <div className="space-y-1">
      <span className="block font-mono text-xs italic text-stone-500">{item.label}</span>
      {decision ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-react-decision>
          <span
            data-decision-kind={item.decisionKind}
            className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${decision.badge}`}
          >
            <span aria-hidden>{decision.icon}</span>
            {decision.label}
          </span>
          {item.decisionReasoning ? (
            <span className="text-xs text-stone-600">{item.decisionReasoning}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

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
  sections: isEmptyOutput(output) ? [{ kind: 'text', label: '', value: '(no output)' }] : []
})

const statusStyles: Record<
  'ok' | 'error' | 'warn',
  { border: string; summary: string; body: string; badge: string; icon: string; label: string }
> = {
  ok: {
    border: 'border-stone-200/70 bg-white/60',
    summary: 'text-stone-600',
    body: 'border-stone-100 text-[var(--muted)]',
    // The non-colour cue: a glyph + spelled-out word so the outcome never relies on
    // colour alone (WCAG 1.4.1, mirroring the gauge and the ReAct decision badge).
    badge: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    icon: '✓',
    label: 'OK'
  },
  error: {
    border: 'border-rose-200 bg-rose-50/70',
    summary: 'text-rose-700',
    body: 'border-rose-100 text-rose-700',
    badge: 'border-rose-300 bg-rose-50 text-rose-700',
    icon: '✕',
    label: 'Error'
  },
  warn: {
    border: 'border-amber-200 bg-amber-50/70',
    summary: 'text-amber-800',
    body: 'border-amber-100 text-amber-800',
    badge: 'border-amber-300 bg-amber-50 text-amber-800',
    icon: '⚠',
    label: 'Warning'
  }
}

// Renders one ActivityView section. `text` is a label/value row (untrusted output,
// shown as plain text — never HTML — with newlines preserved so multi-line values
// like console logs read correctly); `code` is a read-only, syntax-highlighted
// CodeMirror block (the same renderer the permission modal uses); `json` is a
// serialized dump. Mirrors the permission modal's section renderer.
const ActivitySectionEntry = ({ section }: { section: ActivityView['sections'][number] }) => {
  if (section.kind === 'code') {
    return (
      <div>
        {section.label ? <span className="text-[var(--muted)]">{section.label}</span> : null}
        <ReadOnlyCodeView
          value={section.code}
          language={section.language}
          className="tt-code-editor mt-1 max-h-72 overflow-auto rounded-md border border-stone-200"
        />
      </div>
    )
  }
  if (section.kind === 'json') {
    return (
      <div>
        {section.label ? <span className="text-[var(--muted)]">{section.label}: </span> : null}
        <pre className="mt-1 overflow-x-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-stone-700">
          {safeJson(section.value)}
        </pre>
      </div>
    )
  }
  return (
    <div>
      {section.label ? <span className="text-[var(--muted)]">{section.label}: </span> : null}
      <span className="whitespace-pre-wrap text-stone-600">{section.value}</span>
    </div>
  )
}

// Serializes a json section value defensively so a non-serializable value (e.g. a
// cyclic object) can never throw while rendering the panel.
const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return '(value could not be displayed)'
  }
}

// One generic renderer for every completed tool. It is driven entirely by the
// resolved ActivityView and never branches on a tool id — each tool's owner (a
// plugin, or the MCP layer) decides title/status/sections. text/json values are
// rendered as plain text; tool output is untrusted and never injected as HTML.
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
        <span className="flex-1">{view.title}</span>
        <span
          data-activity-status={view.status ?? 'ok'}
          className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles.badge}`}
        >
          <span aria-hidden>{styles.icon}</span>
          {styles.label}
        </span>
      </summary>
      <div className={`space-y-1 border-t px-3 py-1.5 ${styles.body}`}>
        {view.sections.map((section, index) => (
          <ActivitySectionEntry
            key={`${section.kind}-${section.label}-${index}`}
            section={section}
          />
        ))}
      </div>
    </details>
  )
}

// Resolves a completed tool's ActivityView. A summarizer may be async (e.g. the
// code-exec one lazy-loads a formatter to pretty-print the call's source), so the
// view is resolved in an effect — mirroring the permission modal's
// PermissionInputView. A synchronous summarizer (MCP, the neutral default) resolves
// on first render with no flicker; an async one shows the title-only frame until it
// settles, and a summarizer's `report` is forwarded to telemetry once.
const CompletedToolEntry = ({
  item,
  label,
  resolveSummarizer
}: {
  item: ToolItem
  label: string
  resolveSummarizer: ResolveActivitySummarizer
}) => {
  const produced = useMemo(() => {
    const summarizer = resolveSummarizer(item.toolId)
    return summarizer ? summarizer(item.output, item.input) : neutralView(label, item.output)
  }, [resolveSummarizer, item.toolId, item.output, item.input, label])

  const [view, setView] = useState<ActivityView | null>(() =>
    produced instanceof Promise ? null : produced
  )

  useEffect(() => {
    if (!(produced instanceof Promise)) {
      setView(produced)
      if (produced.report) {
        forwardPluginReport(produced.report)
      }
      return
    }
    let cancelled = false
    setView(null)
    void produced
      .then((resolved) => {
        if (cancelled) {
          return
        }
        setView(resolved)
        if (resolved.report) {
          forwardPluginReport(resolved.report)
        }
      })
      .catch(() => {
        // A summarizer is expected to fail open; if one rejects anyway, fall back to
        // the neutral default rather than leaving the row stuck on its frame.
        if (!cancelled) {
          setView(neutralView(label, item.output))
        }
      })
    return () => {
      cancelled = true
    }
  }, [produced, label, item.output])

  return <ActivityViewEntry view={view ?? { title: label, sections: [] }} />
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

  return <CompletedToolEntry item={item} label={label} resolveSummarizer={resolveSummarizer} />
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
                        <LabelEntry item={item} />
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
