/*
 * Reasoning/tool activity, under the turn it belongs to.
 *
 * ## Palette (issue #496)
 *
 * This panel is rendered by BOTH chat surfaces — `floating-chat-surface.tsx` and
 * `docked-chat-surface.tsx` — and it was the last part of the conversation
 * surface still painted in literal light neutrals: 36 `stone-*`/`white` classes
 * on the containers, summaries, code frames and gutters. That was invisible
 * while every host was light. It stopped being invisible the moment a host
 * supplied a dark palette: the documentation assistant has had a dark mode since
 * #480, so a reader in dark mode who expanded a tool call got a white card on a
 * near-black panel, on `/docs/` and on `/widget` alike.
 *
 * Structural chrome now reads the token graph, so a host that overrides the six
 * bases recolours this panel with the rest of the surface. What stays literal:
 * the `error`/`warn` status styles and their badges, which carry MEANING in
 * their colour rather than palette — the same rule `docked-chat-surface.tsx`'s
 * notices and destructive hovers follow.
 */
import type {
  ActivitySummarizer,
  ActivityView,
  TurnActivity,
  TurnActivityItem
} from '@tinytinkerer/app-core'
import {
  boundedJson,
  partitionToolResultMedia,
  type ReActDecisionKind
} from '@tinytinkerer/contracts'
import { ReadOnlyCodeView } from '@tinytinkerer/content-code'
import { memo, useEffect, useState } from 'react'
import { useResolvedPluginView, type PluginViewResolution } from './resolved-plugin-view'
import { captureTelemetryMessage } from './telemetry/telemetry'

// Resolves the activity summarizer a tool's owner provides, keyed by tool id, or
// `undefined` for tools that ship none (the host then uses a neutral default).
// The host builds this so the panel itself carries zero tool-specific knowledge.
export type ResolveActivitySummarizer = (toolId: string) => ActivitySummarizer | undefined

// Mirrors @tinytinkerer/ui ThinkingDots without taking a UI-package dependency
// here (app-browser stays free of the UI lib, like the local ToggleRow). The
// `thinking-dot` animation class is provided globally by the host app CSS.
const ThinkingDots = () => (
  <span aria-label="Thinking" className="inline-flex items-end gap-0.5 pb-0.5">
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
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

// One reasoning/activity label row. A ReAct `think` step renders the model's
// thinking (its streamed chain-of-thought, italic) and, once its decision
// resolves, a colour+glyph+word badge for the decision kind. The model's prose is
// the single source of "why": it IS the label. When the model emitted no prose (a
// native tool-call turn with no content), the label is empty and the step renders
// as just the decision badge — the chosen tool + args are shown by the adjacent
// tool activity row (issue #276).
const LabelEntry = ({ item }: { item: LabelItem }) => {
  if (item.stepKind !== 'think') {
    return <span className="text-xs text-[var(--muted)]">{item.label}</span>
  }

  const decision = item.decisionKind ? decisionStyles[item.decisionKind] : undefined
  return (
    <div className="space-y-1">
      {item.label ? (
        <span className="block font-mono text-xs italic text-[var(--muted)]">{item.label}</span>
      ) : null}
      {decision ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1" data-react-decision>
          <span
            data-decision-kind={item.decisionKind}
            className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${decision.badge}`}
          >
            <span aria-hidden>{decision.icon}</span>
            {decision.label}
          </span>
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
// It cannot assume any output shape, so it names the tool and either says there was
// no output or — so a tool's result is never silently dropped from the timeline —
// renders the raw output as a json section (the panel bounds the serialized size).
// Generic across every tool (no tool-id branching): `partitionToolResultMedia` is
// structural, so any tool whose output carries a `media` array gets those images
// rendered as real `image` sections first, with whatever remains of the payload
// still shown as a json dump right after — a tool's result is never silently
// dropped from the timeline just because it also has images.
const neutralView = (label: string, output: unknown): ActivityView => {
  if (isEmptyOutput(output)) {
    return {
      title: label,
      status: 'unknown',
      sections: [{ kind: 'text', label: '', value: '(no output)' }]
    }
  }

  const { rest, media } = partitionToolResultMedia(output)
  if (media.length === 0) {
    return {
      title: label,
      status: 'unknown',
      sections: [{ kind: 'json', label: 'Output', value: output }]
    }
  }

  const sections: ActivityView['sections'] = media.map((item) => ({
    kind: 'image',
    label: 'Image',
    dataUrl: item.dataUrl,
    alt: item.description,
    width: item.width,
    height: item.height
  }))
  if (!isEmptyOutput(rest)) {
    sections.push({ kind: 'json', label: 'Output', value: rest })
  }
  return { title: label, status: 'unknown', sections }
}

const statusStyles: Record<
  NonNullable<ActivityView['status']>,
  { border: string; summary: string; body: string; badge: string; icon: string; label: string }
> = {
  ok: {
    border: 'border-[var(--border)] bg-[var(--panel-hover)]',
    summary: 'text-[var(--muted)]',
    body: 'border-[var(--border)] text-[var(--muted)]',
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
  },
  unknown: {
    border: 'border-[var(--border)] bg-[var(--panel-hover)]',
    summary: 'text-[var(--muted)]',
    body: 'border-[var(--border)] text-[var(--muted)]',
    badge: 'border-[var(--border)] bg-[var(--panel-hover)] text-[var(--muted)]',
    icon: '?',
    label: 'Unknown'
  }
}

// Renders one ActivityView section. `text` is a label/value row (untrusted output,
// shown as plain text — never HTML — with newlines preserved so multi-line values
// like console logs read correctly); `code` is a read-only, syntax-highlighted
// CodeMirror block (the same renderer the permission modal uses); `json` is a
// serialized dump; `image` is a real, bounded `<img>` rendered from the section's
// persisted `dataUrl` — a guaranteed render, unlike the model-elected `media:` ref
// resolution in the chat transcript (content-image's ImageNodeRenderer). Mirrors
// the permission modal's section renderer.
const ActivitySectionEntry = ({ section }: { section: ActivityView['sections'][number] }) => {
  if (section.kind === 'code') {
    return (
      <div>
        {section.label ? <span className="text-[var(--muted)]">{section.label}</span> : null}
        <ReadOnlyCodeView
          value={section.code}
          language={section.language}
          className="tt-code-editor mt-1 max-h-72 overflow-auto rounded-md border border-[var(--border)]"
        />
      </div>
    )
  }
  if (section.kind === 'json') {
    return (
      <div>
        {section.label ? <span className="text-[var(--muted)]">{section.label}: </span> : null}
        <pre className="mt-1 overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--panel-hover)] p-2 text-[var(--text)]">
          {boundedJson(section.value, MAX_JSON_CHARS)}
        </pre>
      </div>
    )
  }
  if (section.kind === 'image') {
    return (
      <div>
        {section.label ? <span className="text-[var(--muted)]">{section.label}</span> : null}
        <img
          src={section.dataUrl}
          alt={section.alt}
          loading="lazy"
          decoding="async"
          className="mt-1 block max-h-72 max-w-full rounded-md border border-[var(--border)] object-contain"
        />
      </div>
    )
  }
  // Only `text` sections remain here: a data URL in the `image` branch's `<img
  // src>` is inert (it cannot execute script), so it is safe despite carrying
  // untrusted tool output — but text/json values are still rendered as plain
  // text, never HTML.
  return (
    <div>
      {section.label ? <span className="text-[var(--muted)]">{section.label}: </span> : null}
      <span className="whitespace-pre-wrap text-[var(--muted)]">{section.value}</span>
    </div>
  )
}

// Longest serialized json a section will inline. A tool can return a large payload
// (e.g. a raw-output fallback for an un-summarized tool); cap it so the panel DOM
// stays bounded. The full result still reaches the model.
const MAX_JSON_CHARS = 4_000

// One generic renderer for every completed tool. It is driven entirely by the
// resolved ActivityView and never branches on a tool id — each tool's owner (a
// plugin, or the MCP layer) decides title/status/sections. text/json values are
// rendered as plain text; tool output is untrusted and never injected as HTML.
const ActivityViewEntry = ({
  view,
  resolving = false
}: {
  view: ActivityView
  resolving?: boolean
}) => {
  // Runtime defense for untyped/older third-party contributions. The contract
  // requires status, but the renderer must not crash if a JS plugin omits it.
  const status = view.status ?? 'unknown'
  const styles = statusStyles[status]
  return (
    <details className={`group rounded-md border text-xs ${styles.border}`}>
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 hover:bg-[var(--panel-hover)] ${styles.summary}`}
      >
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-[var(--panel-hover)] text-[9px] font-bold text-[var(--muted)] transition-transform group-open:rotate-90">
          ▶
        </span>
        <span className="flex-1">{view.title}</span>
        {resolving ? (
          <span
            data-activity-resolution="pending"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel-hover)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]"
          >
            <ThinkingDots />
            Resolving
          </span>
        ) : (
          <span
            data-activity-status={status}
            className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles.badge}`}
          >
            <span aria-hidden>{styles.icon}</span>
            {styles.label}
          </span>
        )}
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

// Resolves a completed tool's ActivityView. The stable key deliberately excludes
// raw input/output object references: buildTurns recreates projected items as live
// events stream, so keying on those objects would re-run async summarizers and
// duplicate reports for the same completed tool row.
const CompletedToolEntry = ({
  item,
  label,
  resolveSummarizer
}: {
  item: ToolItem
  label: string
  resolveSummarizer: ResolveActivitySummarizer
}) => {
  const summarizer = resolveSummarizer(item.toolId)
  const hasSummarizer = summarizer !== undefined
  const reportUnknown = (view: ActivityView, resolution: PluginViewResolution): void => {
    if (view.status !== undefined && view.status !== 'unknown') {
      return
    }
    const reason = !hasSummarizer
      ? 'missing_summarizer'
      : resolution === 'threw'
        ? 'summarizer_threw'
        : resolution === 'rejected'
          ? 'summarizer_rejected'
          : view.status === undefined
            ? 'missing_status'
            : 'explicit_unknown'
    captureTelemetryMessage(`Tool activity resolved to unknown status: ${item.toolId}`, {
      level: 'warning',
      tags: {
        area: 'tool-activity',
        tool: item.toolId,
        reason
      },
      fingerprint: ['tool-activity-unknown', reason, item.toolId]
    })
  }
  const { view, pending } = useResolvedPluginView<ActivityView>({
    viewKey: `activity:${item.id}:${item.toolId}:${label}:${hasSummarizer ? 'owner' : 'neutral'}`,
    fallback: { title: label, status: 'unknown', sections: [] },
    resolveView: () =>
      summarizer ? summarizer(item.output, item.input) : neutralView(label, item.output),
    onSettled: reportUnknown
  })

  return <ActivityViewEntry view={view} resolving={pending} />
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
      <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-hover)] px-3 py-1.5 text-xs text-[var(--muted)]">
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
// Memoized alongside TurnChrome (issue #340): with settled turns keeping their
// object identity (activity included) via the surface's reconcileTurns, and a
// memoized serverNameById/resolveSummarizer, the default shallow comparison
// skips re-rendering every past turn's panel on each streamed delta.
export const TurnActivityPanel = memo(function TurnActivityPanel({
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
}) {
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
          className="text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {open ? (
        <div className="mt-2 space-y-2">
          {hasReasoning ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--panel-hover)] px-3 py-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">
                Reasoning
              </p>
              <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--muted)]">
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
                      className="mt-1 shrink-0 select-none font-mono text-[10px] leading-none text-[var(--muted)]"
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
})
