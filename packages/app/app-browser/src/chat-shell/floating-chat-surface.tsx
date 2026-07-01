import { Suspense, useState, type ComponentType } from 'react'
// Icons come straight from the external react-icons (not @tinytinkerer/ui): the
// boundary check forbids app-browser depending on the ui package (see turn-chrome's
// local-primitive precedent), and react-icons is the same source ui re-exports.
import { FaArrowUp, FaGear, FaGithub, FaMicrophone, FaRotateLeft, FaStop } from 'react-icons/fa6'
import { ConversationEmptyState } from '../conversation-empty-state'
import { HumanPromptComposerDock } from '../human-prompt-composer-dock'
import { JumpToLatestButton } from '../jump-to-latest'
import { LazySettingsPanel } from '../lazy-browser-settings-modal'
import { TurnChrome } from '../turn-chrome'
import {
  useChatComposer,
  useChatSurfaceController,
  useSettingsSurfaceController
} from '../surfaces'
import { useStickToBottom } from '../use-stick-to-bottom'
import { surfaceButtonClass } from './surface-button'

// The compact-session loading/error view, supplied by the host app so each shell
// keeps its own boot copy and palette.
export type ChatLoadingComponent = ComponentType<{ error?: string }>

export type FloatingChatSurfaceProps = {
  LoadingComponent: ChatLoadingComponent
  // Whether to draw the rounded framed card around the conversation. Floating
  // shells supply their own glass frame, so they pass `false`.
  framed?: boolean
}

// The compact chat body shared by every floating layout (the widget app and the
// canvas app's overlay). It is pure composition over the shared chat-surface hooks
// — no layout/drag/resize concerns live here; that is the floating layout's job
// (see floating-layout.tsx).
export const FloatingChatSurface = ({
  LoadingComponent,
  framed = true
}: FloatingChatSurfaceProps) => {
  const {
    isBooting,
    initializeError,
    events,
    turns,
    serverNameById,
    isRunning,
    isRetryPending,
    submitLabel,
    isCoolingDown,
    submitPrompt,
    rerunLastPrompt,
    canRerun,
    resetConversation,
    cancelRetry,
    stop
  } = useChatSurfaceController()
  const { token } = useSettingsSurfaceController()
  const { prompt, setPrompt, speech, handleSubmit } = useChatComposer(submitPrompt)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { scrollRef, showJumpButton, scrollToBottom } = useStickToBottom<HTMLDivElement>(events)

  if (isBooting || initializeError) {
    return <LoadingComponent {...(initializeError ? { error: initializeError } : {})} />
  }

  return (
    <div className="relative flex h-full w-full flex-col px-2.5 py-2.5">
      <div
        className={[
          'flex h-full min-h-0 flex-col',
          framed
            ? 'rounded-[1.5rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] shadow-[0_18px_48px_rgba(36,33,24,0.08)]'
            : 'bg-transparent'
        ].join(' ')}
      >
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {turns.length === 0 ? (
            <ConversationEmptyState count={1} onSelectPrompt={setPrompt} />
          ) : (
            <div className="space-y-2.5">
              {turns.map((turn, index) => (
                <div key={turn.id} className="space-y-1">
                  {turn.userText ? (
                    <div className="rounded-xl bg-[var(--user-bubble)] px-2.5 py-1.5 text-[13px] leading-5 text-[var(--text)]">
                      {turn.userText}
                    </div>
                  ) : null}
                  {turn.notice ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-4 text-amber-800">
                      {turn.notice.message}
                    </div>
                  ) : null}
                  <TurnChrome
                    turn={turn}
                    isLive={isRunning && index === turns.length - 1}
                    serverNameById={serverNameById}
                    bubbleClassName="rounded-xl border border-[var(--widget-border)] bg-[var(--panel)] px-2.5 py-2"
                    contentClassName="widget-prose text-[13px] leading-5"
                    {...(index === turns.length - 1
                      ? {
                          onRegenerateLatest: () => void rerunLastPrompt(),
                          canRegenerateLatest: canRerun
                        }
                      : {})}
                  />
                </div>
              ))}
            </div>
          )}
          <JumpToLatestButton
            visible={showJumpButton}
            onClick={() => scrollToBottom()}
            className="sticky bottom-1 left-1/2 z-10 -translate-x-1/2"
          />
        </div>

        {/* Composer-docked human prompt (issue #85), shown above the message box when
            the choice plugin's presentation is "composer". */}
        <HumanPromptComposerDock />

        <div className="border-t border-[var(--widget-border)] px-3 py-2.5">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!isCoolingDown) handleSubmit()
              }
            }}
            aria-label="Message"
            placeholder="Ask something current, compare options, or continue the thread."
            rows={2}
            className="min-h-16 max-h-28 w-full rounded-xl border border-[var(--widget-border)] bg-[var(--panel)] px-3 py-2 text-[13px] leading-5 outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
            {/* Left: settings, sign in, reset */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--widget-text)]"
              >
                <FaGear className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              {!token ? (
                <button
                  type="button"
                  aria-label="Sign in with GitHub"
                  title="Sign in with GitHub"
                  onClick={() => setSettingsOpen(true)}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] transition-colors hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--widget-text)]"
                >
                  <FaGithub className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Reset conversation"
                title="Reset conversation"
                onClick={() => void resetConversation()}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
              >
                <FaRotateLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {/* Right: microphone, stop/send */}
            <div className="flex items-center gap-1.5">
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
                  className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    speech.listening
                      ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'border-[var(--widget-border)] bg-[var(--panel)] text-[var(--widget-muted)] hover:border-[var(--border)] hover:bg-[var(--panel-hover)] hover:text-[var(--widget-text)]'
                  }`}
                >
                  <FaMicrophone className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : null}
              {isRetryPending && isCoolingDown ? (
                <button
                  type="button"
                  className={surfaceButtonClass('secondary')}
                  onClick={cancelRetry}
                >
                  Cancel retry
                </button>
              ) : null}
              {isRunning ? (
                <button
                  type="button"
                  className={surfaceButtonClass('secondary', 'h-8 min-w-8 px-2')}
                  aria-label="Stop generating"
                  title="Stop generating"
                  onClick={stop}
                >
                  <FaStop className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : (
                <button
                  type="button"
                  className={surfaceButtonClass('default', 'h-8 min-w-8 px-2')}
                  aria-label={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  title={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  onClick={() => handleSubmit()}
                  disabled={isCoolingDown || !prompt.trim()}
                >
                  {isCoolingDown ? (
                    <span className="text-[11px] tabular-nums">{submitLabel}</span>
                  ) : (
                    <FaArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
          </div>
          {speech.error ? (
            <p role="alert" className="mt-1.5 text-[11px] text-rose-600">
              {speech.error}
            </p>
          ) : null}
        </div>
      </div>
      {settingsOpen ? (
        <Suspense fallback={null}>
          {/* Inline slide-over rather than a centered modal: a floating widget is an
              embedded surface, so settings must not cover the host page. */}
          <LazySettingsPanel
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            presentation="inline"
          />
        </Suspense>
      ) : null}
    </div>
  )
}
