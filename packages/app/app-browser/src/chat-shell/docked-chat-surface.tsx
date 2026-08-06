import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
// Icons come straight from react-icons (not @tinytinkerer/ui): app-browser must not
// depend on the ui package. These are the same glyphs ui re-exports, so the merged
// web/mobile body renders identically without pulling in ui.
import { FaArrowUp, FaGear, FaGithub, FaRotateLeft, FaStop } from 'react-icons/fa6'
import { ContextGaugeSlot } from '../context-gauge'
import { ContextInspectorSlot } from '../context-inspector'
import { ConversationEmptyState } from '../conversation-empty-state'
import { HumanPromptComposerDock } from '../human-prompt-composer-dock'
import { JumpToLatestButton } from '../jump-to-latest'
import { LazyBrowserSettingsModal } from '../lazy-browser-settings-modal'
import { ToolTreeSlot } from '../tool-tree'
import { TurnActivityPanel } from '../turn-activity-panel'
import { TurnChrome } from '../turn-chrome'
import {
  useChatComposer,
  useChatSurfaceController,
  useSettingsSurfaceController
} from '../surfaces'
import { useStickToBottom } from '../use-stick-to-bottom'
import { SpeechToggleButton } from './speech-toggle-button'
import { surfaceButtonClass } from './surface-button'
import type { ChatLoadingComponent } from './floating-chat-surface'

/*
 * Semantic notices, deliberately still literal (issue #496).
 *
 * `warning` and `error` carry MEANING in their colour, the same way the
 * destructive hovers below do, and the shared convention since the token graph
 * landed is that those stay fixed while structural chrome reads tokens. `info`
 * is the exception that had to move: it is not semantic, it is "an ordinary
 * notice", and stone-on-stone is simply the light palette written out.
 */
const noticeStyle: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-[var(--border)] bg-[var(--panel-hover)] text-[var(--muted)]',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700'
}

/*
 * The composer's icon-button chrome, hoisted because it is repeated (issue
 * #496).
 *
 * Four controls render it — settings, sign-in, reset and the microphone — and it
 * was four copies of a literal light palette. Tokenising it made each copy ~70
 * characters longer, which put the chat route chunk over its 60 kB budget; the
 * budget's own note says the next addition needs a real reduction beside it
 * rather than a raise, and three of these four copies were exactly that.
 *
 * Split at the hover text colour because that is the only axis they differ on:
 * the reset control keeps a literal rose hover (destructive signal, not
 * palette), and settings settles on `--text` where the other two use
 * `--text-strong`.
 */
const CONTROL_CHROME =
  'border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:bg-[var(--panel-hover)]'
const CONTROL_CHROME_FILLED = `${CONTROL_CHROME} bg-[var(--panel)] hover:text-[var(--text-strong)]`

/*
 * What the two size variants SHARE (issue #496).
 *
 * `comfortable` and `mobile` differ only on size — radius, padding, font size —
 * which is what `sizeVariant` means. Their palette and behaviour were duplicated
 * character for character, and tokenising made each copy ~40 characters longer.
 * Hoisted rather than raising the chat route's 60 kB budget, whose note asks for
 * a real reduction beside any addition; leaving only the size deltas in VARIANTS
 * also makes that table say what it is for.
 */
const COMPOSER_INPUT =
  'w-full resize-none border border-[var(--border)] bg-[var(--panel)] px-3 leading-relaxed text-[var(--text)] outline-none ring-[var(--accent-ring)] transition focus:ring-2'
const TURN_BUBBLE = 'bg-[var(--panel)] px-3 text-sm text-[var(--text-strong)] shadow-sm'
const USER_BUBBLE = 'wrap-anywhere bg-[var(--user-bubble)] px-3 text-sm text-[var(--text)]'

export type DockedSizeVariant = 'comfortable' | 'mobile'

// Per-variant chrome. `comfortable` is the full-width web presentation (bordered
// conversation card, hint line, square-ish controls); `mobile` is the narrow
// full-viewport presentation (safe-area padding, pill controls, turn counter).
type VariantConfig = {
  main: string
  section: string
  showTurnCount: boolean
  scroll: string
  emptyCount: number
  emptyClassName?: string
  userBubble: string
  noticeRadius: string
  turnBubble: string
  jump: string
  form: string
  textarea: string
  textareaMinHeight: string
  autoGrowMax: number
  showHint: boolean
  actionsRow: string
  iconButtonSize: string
  settingsHasBg: boolean
  sendStopExtra: string
  cancelExtra: string
}

const VARIANTS: Record<DockedSizeVariant, VariantConfig> = {
  comfortable: {
    main: 'flex flex-1 flex-col gap-3 overflow-hidden px-4 py-4 md:px-8',
    section:
      'relative flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm',
    showTurnCount: false,
    scroll: 'mt-3 flex-1 overflow-y-auto space-y-4',
    emptyCount: 4,
    userBubble: `rounded-lg py-2 ${USER_BUBBLE}`,
    noticeRadius: 'rounded-lg',
    turnBubble: `rounded-lg py-2 ${TURN_BUBBLE}`,
    jump: 'absolute bottom-4 left-1/2 z-10 -translate-x-1/2',
    form: 'rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-sm',
    textarea: `rounded-md py-2.5 text-sm ${COMPOSER_INPUT}`,
    textareaMinHeight: '44px',
    autoGrowMax: 200,
    showHint: true,
    actionsRow: 'mt-2 flex items-center justify-between gap-2',
    iconButtonSize: 'h-9 w-9 rounded-md',
    settingsHasBg: false,
    sendStopExtra: 'h-9 min-w-9 px-2',
    cancelExtra: 'h-9 px-3'
  },
  mobile: {
    main: 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)]',
    section: 'relative flex min-h-0 flex-1 flex-col px-1 py-1',
    showTurnCount: true,
    scroll: 'mt-3 flex-1 space-y-4 overflow-y-auto pr-1',
    emptyCount: 2,
    emptyClassName:
      'rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel)] px-4 py-5',
    userBubble: `rounded-2xl py-2.5 ${USER_BUBBLE}`,
    noticeRadius: 'rounded-2xl',
    turnBubble: `rounded-2xl py-3 ${TURN_BUBBLE}`,
    jump: 'absolute bottom-3 left-1/2 z-10 -translate-x-1/2',
    form: 'px-1 py-1',
    textarea: `rounded-2xl py-3 text-base ${COMPOSER_INPUT}`,
    textareaMinHeight: '52px',
    autoGrowMax: 180,
    showHint: false,
    actionsRow: 'mt-3 flex items-center justify-between gap-2',
    iconButtonSize: 'h-10 w-10 rounded-full',
    settingsHasBg: true,
    sendStopExtra: 'h-10 min-w-10 rounded-full px-2',
    cancelExtra: 'h-9 px-3 rounded-full'
  }
}

export type DockedChatSurfaceProps = {
  LoadingComponent: ChatLoadingComponent
  sizeVariant?: DockedSizeVariant
  // Install banner (mobile PWA only), supplied by the app page.
  installSlot?: ReactNode
  // Whether this shell hosts the developer context-inspector: enables the inspector
  // plugin's toggle in Settings AND renders the viewer button (below) in the
  // composer's left action row.
  inspectorPanelSupported?: boolean
  // Per-shell Suspense fallback while the settings modal chunk loads.
  settingsFallback?: ReactNode
  // Surface-supplied cold-start suggestions and how many to show (issue #480).
  // Omitted keeps the app's own prompts and this variant's `emptyCount`.
  starterPrompts?: readonly string[]
  starterPromptCount?: number
}

// The docked, full-height chat body shared by the web and mobile shells. It was two
// near-identical copies (apps/web chat-page + apps/mobile mobile-page); the only
// real differences are container chrome, which the `sizeVariant` config drives, and
// the ui-specific slots (inspector, install banner) injected by the app page.
export const DockedChatSurface = ({
  LoadingComponent,
  sizeVariant = 'comfortable',
  installSlot,
  inspectorPanelSupported,
  settingsFallback,
  starterPrompts,
  starterPromptCount
}: DockedChatSurfaceProps) => {
  const {
    isBooting,
    initializeError,
    events,
    token,
    turns,
    serverNameById,
    resolveActivitySummarizer,
    isRunning,
    isRetryPending,
    showReasoningActivity,
    submitLabel,
    isCoolingDown,
    submitPrompt,
    rerunLastPrompt,
    canRerun,
    resetConversation,
    cancelRetry,
    stop,
    sendRefusalNotice
  } = useChatSurfaceController()
  const { canSignIn, signIn, signInOpensSettings } = useSettingsSurfaceController()
  const { prompt, setPrompt, speech, handleSubmit } = useChatComposer(submitPrompt)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [signInUnavailable, setSignInUnavailable] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { scrollRef, showJumpButton, scrollToBottom } = useStickToBottom<HTMLDivElement>(events)
  const v = VARIANTS[sizeVariant]

  // Auto-grow textarea.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, v.autoGrowMax)}px`
  }, [prompt, v.autoGrowMax])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  if (isBooting || initializeError) {
    return <LoadingComponent {...(initializeError ? { error: initializeError } : {})} />
  }

  const iconButtonBase = `flex ${v.iconButtonSize} items-center justify-center border transition-colors`
  const headingClass = 'text-xs font-semibold uppercase tracking-wider text-[var(--muted)]'

  return (
    <div
      className={[
        // `text-[var(--text)]` on BOTH variants (issue #496). Only `mobile` set
        // it; `comfortable` left the surface inheriting from whatever contained
        // it, which is fine in a deployable app whose body is already this
        // colour and wrong in an embedded one, where it inherited the HOST's
        // font colour — the documentation's Infima base, which is theme-aware
        // while the panel under it was not.
        'mx-auto flex h-full w-full flex-col text-[var(--text)]',
        sizeVariant === 'mobile' ? 'max-w-screen-sm' : 'max-w-5xl'
      ].join(' ')}
    >
      <main className={v.main}>
        {installSlot}

        {/* Conversation */}
        <section className={v.section}>
          {v.showTurnCount ? (
            <div className="flex items-center justify-between gap-3">
              <h2 className={headingClass}>Conversation</h2>
              <span className="rounded-full border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
                {turns.length} turn{turns.length === 1 ? '' : 's'}
              </span>
            </div>
          ) : (
            <h2 className={`shrink-0 ${headingClass}`}>Conversation</h2>
          )}

          <div ref={scrollRef} className={v.scroll}>
            {turns.length === 0 ? (
              <ConversationEmptyState
                count={starterPromptCount ?? v.emptyCount}
                onSelectPrompt={setPrompt}
                {...(starterPrompts !== undefined ? { starterPrompts } : {})}
                {...(v.emptyClassName ? { className: v.emptyClassName } : {})}
              />
            ) : (
              turns.map((turn, index) => (
                <div key={turn.id} className="space-y-2">
                  {turn.userText ? <p className={v.userBubble}>{turn.userText}</p> : null}

                  {turn.notice ? (
                    <div
                      className={`${v.noticeRadius} border px-3 py-2 text-sm ${noticeStyle[turn.notice.level ?? 'info']}`}
                    >
                      {turn.notice.message}
                    </div>
                  ) : null}

                  {showReasoningActivity ? (
                    <TurnActivityPanel
                      activity={turn.activity}
                      isLive={isRunning && index === turns.length - 1}
                      serverNameById={serverNameById}
                      resolveSummarizer={resolveActivitySummarizer}
                    />
                  ) : null}

                  <TurnChrome
                    turn={turn}
                    isLive={isRunning && index === turns.length - 1}
                    serverNameById={serverNameById}
                    bubbleClassName={v.turnBubble}
                    contentClassName="prose-assistant"
                    {...(index === turns.length - 1
                      ? {
                          onRegenerateLatest: () => void rerunLastPrompt(),
                          canRegenerateLatest: canRerun
                        }
                      : {})}
                  />
                </div>
              ))
            )}
          </div>

          <JumpToLatestButton
            visible={showJumpButton}
            onClick={() => scrollToBottom()}
            className={v.jump}
          />
        </section>

        {/* A composer-docked human prompt (issue #85) renders here, just above the
            message box, when the choice plugin's presentation is set to "composer". */}
        <HumanPromptComposerDock />

        {/* Composer */}
        <form
          className={v.form}
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Message"
            placeholder="Ask anything…"
            rows={1}
            className={v.textarea}
            style={{ minHeight: v.textareaMinHeight }}
          />
          {v.showHint ? (
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Enter to send • Shift+Enter for newline
            </p>
          ) : null}

          {/* Composer actions */}
          <div className={v.actionsRow}>
            {/* Left: settings, sign in, reset */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
                className={`${iconButtonBase} ${CONTROL_CHROME} ${v.settingsHasBg ? 'bg-[var(--panel)] ' : ''}hover:text-[var(--text)]`}
              >
                <FaGear className="h-4 w-4" aria-hidden="true" />
              </button>

              {/* See the floating body's copy of this: hidden when no sign-in
                  route exists at all, started directly when the host provides
                  one, otherwise still routed through Settings (issue #480). */}
              {!token && canSignIn ? (
                <button
                  type="button"
                  aria-label="Sign in with GitHub"
                  title="Sign in with GitHub"
                  onClick={() =>
                    signInOpensSettings ? setSettingsOpen(true) : setSignInUnavailable(!signIn())
                  }
                  className={`${iconButtonBase} ${CONTROL_CHROME_FILLED}`}
                >
                  <FaGithub className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              <button
                type="button"
                aria-label="Reset conversation"
                title="Reset conversation"
                onClick={() => void resetConversation()}
                // Base chrome is tokenised; the rose hover stays literal because
                // it is the destructive-action signal, not palette.
                className={`${iconButtonBase} border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700`}
              >
                <FaRotateLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              {/* Context-usage gauge (hidden unless the plugin is enabled and the
                  model reports usage against a known context window) */}
              <ContextGaugeSlot className="text-[var(--muted)]" />

              {/* Tool picker (issue #400): unlike the inspector below, this works on
                  every shell — it is not gated on inspectorPanelSupported. Renders
                  nothing until a tool-tree plugin is enabled. */}
              <ToolTreeSlot />

              {/* Context inspector (developer): rendered when the shell opts in via
                  inspectorPanelSupported. Renders nothing until an inspector plugin
                  is enabled and a request has been captured. */}
              {inspectorPanelSupported ? <ContextInspectorSlot /> : null}
            </div>

            {/* Right: microphone, stop/send */}
            <div className="flex items-center gap-2">
              <SpeechToggleButton
                speech={speech}
                className={iconButtonBase}
                idleClassName={CONTROL_CHROME_FILLED}
                iconClassName="h-4 w-4"
              />

              {isRetryPending && isCoolingDown ? (
                <button
                  type="button"
                  className={surfaceButtonClass('secondary', v.cancelExtra)}
                  onClick={cancelRetry}
                >
                  Cancel retry
                </button>
              ) : null}

              {isRunning ? (
                <button
                  type="button"
                  className={surfaceButtonClass('secondary', v.sendStopExtra)}
                  aria-label="Stop generating"
                  title="Stop generating"
                  onClick={stop}
                >
                  <FaStop className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="submit"
                  className={surfaceButtonClass('default', v.sendStopExtra)}
                  aria-label={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  title={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  disabled={isCoolingDown || !prompt.trim()}
                >
                  {isCoolingDown ? (
                    <span className="text-xs tabular-nums">{submitLabel}</span>
                  ) : (
                    <FaArrowUp className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
          </div>

          {speech.error ? (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {speech.error}
            </p>
          ) : null}

          {sendRefusalNotice ? (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {sendRefusalNotice}
            </p>
          ) : null}
          {signInUnavailable ? (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              Sign-in is unavailable in this deployment. You can keep asking questions anonymously.
            </p>
          ) : null}
        </form>
      </main>

      {settingsOpen ? (
        <Suspense fallback={settingsFallback ?? null}>
          <LazyBrowserSettingsModal
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            {...(inspectorPanelSupported ? { inspectorPanelSupported: true } : {})}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
