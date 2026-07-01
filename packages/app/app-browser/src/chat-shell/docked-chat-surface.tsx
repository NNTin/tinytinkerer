import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
// Icons come straight from react-icons (not @tinytinkerer/ui): app-browser must not
// depend on the ui package. These are the same glyphs ui re-exports, so the merged
// web/mobile body renders identically without pulling in ui.
import { FaArrowUp, FaGear, FaGithub, FaMicrophone, FaRotateLeft, FaStop } from 'react-icons/fa6'
import { ContextGaugeSlot } from '../context-gauge'
import { ConversationEmptyState } from '../conversation-empty-state'
import { HumanPromptComposerDock } from '../human-prompt-composer-dock'
import { JumpToLatestButton } from '../jump-to-latest'
import { LazyBrowserSettingsModal } from '../lazy-browser-settings-modal'
import { TurnActivityPanel } from '../turn-activity-panel'
import { TurnChrome } from '../turn-chrome'
import { useChatComposer, useChatSurfaceController } from '../surfaces'
import { useStickToBottom } from '../use-stick-to-bottom'
import { surfaceButtonClass } from './surface-button'
import type { ChatLoadingComponent } from './floating-chat-surface'

const noticeStyle: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-stone-200 bg-stone-50 text-stone-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700'
}

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
    userBubble: 'rounded-lg bg-[var(--user-bubble)] px-3 py-2 text-sm text-[var(--text)]',
    noticeRadius: 'rounded-lg',
    turnBubble:
      'rounded-lg bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text-strong)] shadow-sm',
    jump: 'absolute bottom-4 left-1/2 z-10 -translate-x-1/2',
    form: 'rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-sm',
    textarea:
      'w-full resize-none rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm leading-relaxed outline-none ring-amber-300 transition focus:ring-2',
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
    emptyClassName: 'rounded-2xl border border-dashed border-stone-300 bg-white/70 px-4 py-5',
    userBubble: 'rounded-2xl bg-[var(--user-bubble)] px-3 py-2.5 text-sm text-[var(--text)]',
    noticeRadius: 'rounded-2xl',
    turnBubble:
      'rounded-2xl bg-[var(--panel)] px-3 py-3 text-sm text-[var(--text-strong)] shadow-sm',
    jump: 'absolute bottom-3 left-1/2 z-10 -translate-x-1/2',
    form: 'px-1 py-1',
    textarea:
      'w-full resize-none rounded-2xl border border-stone-300 bg-white px-3 py-3 text-base leading-relaxed outline-none ring-amber-300 transition focus:ring-2',
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
  // Developer context inspector (web only) — passed in by the app page because its
  // trigger icon comes from @tinytinkerer/ui, which app-browser cannot import.
  inspectorSlot?: ReactNode
  // Install banner (mobile PWA only), likewise supplied by the app page.
  installSlot?: ReactNode
  // Whether the settings modal exposes the inspector panel (web).
  inspectorPanelSupported?: boolean
  // Per-shell Suspense fallback while the settings modal chunk loads.
  settingsFallback?: ReactNode
}

// The docked, full-height chat body shared by the web and mobile shells. It was two
// near-identical copies (apps/web chat-page + apps/mobile mobile-page); the only
// real differences are container chrome, which the `sizeVariant` config drives, and
// the ui-specific slots (inspector, install banner) injected by the app page.
export const DockedChatSurface = ({
  LoadingComponent,
  sizeVariant = 'comfortable',
  inspectorSlot,
  installSlot,
  inspectorPanelSupported,
  settingsFallback
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
    stop
  } = useChatSurfaceController()
  const { prompt, setPrompt, speech, handleSubmit } = useChatComposer(submitPrompt)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
        'mx-auto flex h-full w-full flex-col',
        sizeVariant === 'mobile' ? 'max-w-screen-sm text-[var(--text)]' : 'max-w-5xl'
      ].join(' ')}
    >
      <main className={v.main}>
        {installSlot}

        {/* Conversation */}
        <section className={v.section}>
          {v.showTurnCount ? (
            <div className="flex items-center justify-between gap-3">
              <h2 className={headingClass}>Conversation</h2>
              <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-[var(--muted)]">
                {turns.length} turn{turns.length === 1 ? '' : 's'}
              </span>
            </div>
          ) : (
            <h2 className={`shrink-0 ${headingClass}`}>Conversation</h2>
          )}

          <div ref={scrollRef} className={v.scroll}>
            {turns.length === 0 ? (
              <ConversationEmptyState
                count={v.emptyCount}
                onSelectPrompt={setPrompt}
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
                className={`${iconButtonBase} border-stone-200 ${v.settingsHasBg ? 'bg-white ' : ''}text-stone-500 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-700`}
              >
                <FaGear className="h-4 w-4" aria-hidden="true" />
              </button>

              {!token ? (
                <button
                  type="button"
                  aria-label="Sign in with GitHub"
                  title="Sign in with GitHub"
                  onClick={() => setSettingsOpen(true)}
                  className={`${iconButtonBase} border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800`}
                >
                  <FaGithub className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              <button
                type="button"
                aria-label="Reset conversation"
                title="Reset conversation"
                onClick={() => void resetConversation()}
                className={`${iconButtonBase} border-stone-300 bg-white text-stone-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700`}
              >
                <FaRotateLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              {/* Context-usage gauge (hidden unless the plugin is enabled and the
                  model reports usage against a known context window) */}
              <ContextGaugeSlot className="text-stone-500" />

              {/* Context inspector (developer): supplied by the web page only. */}
              {inspectorSlot}
            </div>

            {/* Right: microphone, stop/send */}
            <div className="flex items-center gap-2">
              {speech.visible ? (
                <button
                  type="button"
                  aria-label={speech.available ? 'Voice input' : 'Voice input unavailable'}
                  aria-pressed={speech.listening}
                  title={
                    !speech.available
                      ? 'Voice input is not available in this browser'
                      : speech.listening
                        ? 'Stop voice input'
                        : 'Dictate with the Web Speech API'
                  }
                  disabled={!speech.available}
                  onClick={() => void speech.toggle()}
                  className={`${iconButtonBase} disabled:cursor-not-allowed disabled:opacity-50 ${
                    speech.listening
                      ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800'
                  }`}
                >
                  <FaMicrophone className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

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
