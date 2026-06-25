import type { Turn } from '@tinytinkerer/app-core'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AssistantContent } from './assistant-content'
import { toolLabel } from './turn-activity-panel'

// Local thinking-dots so app-browser stays free of the @tinytinkerer/ui
// dependency (mirrors the copy already in turn-activity-panel). The
// `thinking-dot` animation class is provided globally by the host app CSS.
const ThinkingDots = () => (
  <span aria-label="Thinking" className="inline-flex items-end gap-0.5 pb-0.5">
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-current opacity-60" />
  </span>
)

const CopyIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
      stroke="currentColor"
      strokeWidth="1.3"
    />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
    <path
      d="M3.5 8.5l3 3 6-6.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const RegenerateIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
    <path
      d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const actionButtonClass =
  'inline-flex items-center gap-1 rounded-md border border-transparent px-1.5 py-1 text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]'

// The compact, live "Now: …" status (C2). Derived from the turn's activity log
// so it needs no new event: the latest in-flight tool wins, then the most recent
// reasoning/plan label, then a neutral generating message. Returns null once the
// turn is no longer live. Tool ids are humanized via the shared toolLabel.
export const deriveTurnStatus = (
  turn: Turn,
  serverNameById: Map<string, string>
): string | null => {
  const items = turn.activity.items
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === 'tool' && item.status === 'started') {
      return `Running ${toolLabel(item.toolId, serverNameById)}…`
    }
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind === 'label' && item.label.trim().length > 0) {
      return item.label.trim()
    }
  }
  if (turn.assistantContent) {
    return 'Generating response…'
  }
  return 'Thinking…'
}

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    },
    []
  )

  const handleCopy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {
        // Clipboard can reject (permissions / insecure context). Stay silent —
        // the answer is still on screen; surfacing an error here adds noise.
      })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={actionButtonClass}
      aria-label={copied ? 'Copied message' : 'Copy message'}
      title="Copy message"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

export type TurnActionsProps = {
  // Raw text copied to the clipboard (the assistant's markdown source).
  copyText: string
  collapsed: boolean
  onToggleCollapsed: () => void
  collapsibleId: string
  // Regenerate re-runs the most recent user prompt (`rerunLastPrompt`), which
  // always targets the LATEST turn regardless of which message this row sits on.
  // Wire it only on the latest turn — attaching it to an earlier message would
  // silently regenerate the latest turn, not that message. The name encodes the
  // contract so a future caller does not assume per-message regeneration.
  onRegenerateLatest?: () => void
  canRegenerateLatest?: boolean
}

// The per-message action row (B1): copy, collapse, regenerate. Lives inside
// TurnChrome and is shared by every shell. Regenerate is only rendered when the
// host supplies the capability (after the app-core `rerunLastPrompt` contract).
export const TurnActions = ({
  copyText,
  collapsed,
  onToggleCollapsed,
  collapsibleId,
  onRegenerateLatest,
  canRegenerateLatest = false
}: TurnActionsProps) => (
  <div className="mt-1.5 flex items-center gap-0.5">
    {copyText.trim().length > 0 ? <CopyButton text={copyText} /> : null}
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-expanded={!collapsed}
      aria-controls={collapsibleId}
      className={actionButtonClass}
      title={collapsed ? 'Show full message' : 'Collapse message'}
    >
      <span aria-hidden="true">{collapsed ? 'Show more' : 'Collapse'}</span>
    </button>
    {onRegenerateLatest ? (
      <button
        type="button"
        onClick={onRegenerateLatest}
        disabled={!canRegenerateLatest}
        className={actionButtonClass}
        aria-label="Regenerate response"
        title="Regenerate response"
      >
        <RegenerateIcon />
        <span aria-hidden="true">Regenerate</span>
      </button>
    ) : null}
  </div>
)

export type TurnChromeProps = {
  turn: Turn
  // True when this is the latest turn and a generation is in flight.
  isLive: boolean
  serverNameById: Map<string, string>
  // Bubble styling — each shell keeps its own look (rounded scale, padding).
  bubbleClassName?: string
  // className passed through to AssistantContent (prose variant per shell).
  contentClassName?: string
  // Per-message actions (copy/collapse/regenerate). Default on; the widget can
  // opt out for an ultra-compact surface.
  showActions?: boolean
  // The compact live status line. Default on.
  showStatusLine?: boolean
  // Regenerate re-runs the latest user prompt (see {@link TurnActionsProps}).
  // Pass these only for the latest turn.
  onRegenerateLatest?: () => void
  canRegenerateLatest?: boolean
}

/**
 * Shared boundary for an assistant message (C3). Owns the bubble, the live
 * status line (C2), the assistant content rendering, and the per-message
 * actions (B1) — so web/mobile/widget stop hand-rolling duplicate turn
 * wrappers. Shells pass only presentation (bubble/content classes) and the
 * regenerate capability.
 *
 * Renders nothing when there is neither content nor a live generation, matching
 * the previous `turn.assistantContent ? … : isRunning ? … : null` guard.
 */
export const TurnChrome = ({
  turn,
  isLive,
  serverNameById,
  bubbleClassName,
  contentClassName,
  showActions = true,
  showStatusLine = true,
  onRegenerateLatest,
  canRegenerateLatest = false
}: TurnChromeProps) => {
  const [collapsed, setCollapsed] = useState(false)
  const collapsibleId = useId()

  if (!turn.assistantContent && !isLive) {
    return null
  }

  const status = isLive && showStatusLine ? deriveTurnStatus(turn, serverNameById) : null

  return (
    <div className={bubbleClassName}>
      {status ? (
        <p
          role="status"
          aria-live="polite"
          className="mb-1.5 flex items-center gap-2 text-[11px] text-[var(--muted)]"
        >
          <span className="truncate">{status}</span>
          <ThinkingDots />
        </p>
      ) : null}

      {turn.assistantContent ? (
        <>
          <div id={collapsibleId} hidden={collapsed}>
            <AssistantContent
              content={turn.assistantContent}
              isStreaming={turn.isStreaming}
              turnId={turn.id}
              {...(contentClassName ? { className: contentClassName } : {})}
            />
          </div>
          {collapsed ? (
            <p className="text-[11px] italic text-[var(--muted)]">Message collapsed.</p>
          ) : null}
          {/* Actions appear once streaming settles — a half-written answer has
              nothing stable to copy or regenerate. */}
          {showActions && !turn.isStreaming ? (
            <TurnActions
              copyText={turn.assistantSource}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((value) => !value)}
              collapsibleId={collapsibleId}
              {...(onRegenerateLatest ? { onRegenerateLatest, canRegenerateLatest } : {})}
            />
          ) : null}
        </>
      ) : (
        // Live turn with no content yet: the status line above already conveys
        // progress; when it is suppressed, fall back to bare dots.
        ((!status ? <ThinkingDots /> : null) as ReactNode)
      )}
    </div>
  )
}
