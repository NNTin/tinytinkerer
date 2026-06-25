import {
  ChoicePromptModal,
  ContextGaugeSlot,
  ContextInspectorSlot,
  ConversationEmptyState,
  JumpToLatestButton,
  LazyBrowserSettingsModal,
  PermissionModal,
  TurnActivityPanel,
  TurnChrome,
  useChatComposer,
  useChatSurfaceController,
  useStickToBottom
} from '@tinytinkerer/app-browser'
import {
  Button,
  FaArrowUp,
  FaGear,
  FaGithub,
  FaMicrophone,
  FaReceipt,
  FaRotateLeft,
  FaStop
} from '@tinytinkerer/ui'
import { Suspense, useEffect, useRef, useState } from 'react'
import { WebChatLoading, WebPanelLoading } from '../../app/loading-screen'

const noticeStyle: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-stone-200 bg-stone-50 text-stone-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700'
}

export const ChatPage = () => {
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
  // Smart auto-scroll + "Jump to latest" pill, shared across shells.
  const { scrollRef, showJumpButton, scrollToBottom } = useStickToBottom<HTMLDivElement>(events)

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [prompt])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  if (isBooting || initializeError) {
    return <WebChatLoading {...(initializeError ? { error: initializeError } : {})} />
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-5xl flex-col">
      <main className="flex flex-1 flex-col gap-3 overflow-hidden px-4 py-4 md:px-8">
        {/* Conversation */}
        <section className="relative flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Conversation
          </h2>
          <div ref={scrollRef} className="mt-3 flex-1 overflow-y-auto space-y-4">
            {turns.length === 0 ? (
              <ConversationEmptyState count={4} onSelectPrompt={setPrompt} />
            ) : (
              turns.map((turn, index) => (
                <div key={turn.id} className="space-y-2">
                  {turn.userText ? (
                    <p className="rounded-lg bg-[var(--user-bubble)] px-3 py-2 text-sm text-[var(--text)]">
                      {turn.userText}
                    </p>
                  ) : null}

                  {turn.notice ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-sm ${noticeStyle[turn.notice.level ?? 'info']}`}
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
                    bubbleClassName="rounded-lg bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text-strong)] shadow-sm"
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
            className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
          />
        </section>

        {/* Composer */}
        <form
          className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-sm"
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
            className="w-full resize-none rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm leading-relaxed outline-none ring-amber-300 transition focus:ring-2"
            style={{ minHeight: '44px' }}
          />
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Enter to send • Shift+Enter for newline
          </p>

          {/* Composer actions */}
          <div className="mt-2 flex items-center justify-between gap-2">
            {/* Left: settings, sign in, reset */}
            <div className="flex items-center gap-2">
              {/* Settings trigger */}
              <button
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 text-stone-500 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-700 transition-colors"
              >
                <FaGear className="h-4 w-4" aria-hidden="true" />
              </button>

              {/* Auth entry point — visible only when not signed in */}
              {!token ? (
                <button
                  type="button"
                  aria-label="Sign in with GitHub"
                  title="Sign in with GitHub"
                  onClick={() => setSettingsOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800 transition-colors"
                >
                  <FaGithub className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              {/* Reset */}
              <button
                type="button"
                aria-label="Reset conversation"
                title="Reset conversation"
                onClick={() => void resetConversation()}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 transition-colors"
              >
                <FaRotateLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              {/* Context-usage gauge (hidden unless the plugin is enabled and the
                  model reports usage against a known context window) */}
              <ContextGaugeSlot className="text-stone-500" />

              {/* Context inspector (developer): web app only. Hidden unless the
                  plugin is enabled and at least one request has been captured. */}
              <ContextInspectorSlot icon={<FaReceipt className="h-4 w-4" aria-hidden="true" />} />
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
                  className={`flex h-9 w-9 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    speech.listening
                      ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800'
                  }`}
                >
                  <FaMicrophone className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              {/* Retry cancel */}
              {isRetryPending && isCoolingDown ? (
                <Button type="button" variant="secondary" onClick={cancelRetry}>
                  Cancel retry
                </Button>
              ) : null}

              {/* Stop while running, otherwise Send */}
              {isRunning ? (
                <Button
                  type="button"
                  variant="secondary"
                  aria-label="Stop generating"
                  title="Stop generating"
                  onClick={stop}
                  className="h-9 min-w-9 px-2"
                >
                  <FaStop className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  aria-label={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  title={isCoolingDown ? `Wait ${submitLabel}` : 'Send'}
                  disabled={isCoolingDown || !prompt.trim()}
                  className="h-9 min-w-9 px-2"
                >
                  {isCoolingDown ? (
                    <span className="text-xs tabular-nums">{submitLabel}</span>
                  ) : (
                    <FaArrowUp className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
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
        <Suspense fallback={<WebPanelLoading />}>
          <LazyBrowserSettingsModal
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            inspectorPanelSupported
          />
        </Suspense>
      ) : null}

      <PermissionModal />
      <ChoicePromptModal />
    </div>
  )
}
