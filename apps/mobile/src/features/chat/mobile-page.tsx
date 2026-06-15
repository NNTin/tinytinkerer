import {
  AssistantContent,
  LazyBrowserSettingsModal,
  PermissionModal,
  TurnActivityPanel,
  useChatComposer,
  useChatSurfaceController
} from '@tinytinkerer/app-browser'
import {
  Button,
  FaArrowUp,
  FaGear,
  FaGithub,
  FaMicrophone,
  FaRotateLeft,
  FaSpinner,
  ThinkingDots
} from '@tinytinkerer/ui'
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline'
import { Suspense, useEffect, useRef, useState } from 'react'
import { MobileChatLoading, MobilePanelLoading } from '../../app/loading-screen'
import { useInstallPrompt } from '../install/use-install-prompt'

const noticeStyle: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-stone-200 bg-stone-50 text-stone-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700'
}

export const MobilePage = () => {
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
    resetConversation,
    cancelRetry
  } = useChatSurfaceController()
  const { prompt, setPrompt, speech, handleSubmit } = useChatComposer(submitPrompt)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const conversationEndRef = useRef<HTMLDivElement>(null)
  const { canInstall, showIosHint, promptToInstall } = useInstallPrompt()

  useEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }

    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`
  }, [prompt])

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events])

  if (isBooting || initializeError) {
    return <MobileChatLoading {...(initializeError ? { error: initializeError } : {})} />
  }

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-screen-sm flex-col text-[var(--text)]">
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)]">
        {canInstall || showIosHint ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {showIosHint ? (
              <div className="rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                On iPhone or iPad, use Share {'>'} Add to Home Screen to install this app.
              </div>
            ) : <div />}
            {canInstall ? (
              <Button type="button" size="sm" className="rounded-full" onClick={() => void promptToInstall()}>
                <ArrowDownTrayIcon className="mr-1 h-4 w-4" />
                Install app
              </Button>
            ) : null}
          </div>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col px-1 py-1">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Conversation</h2>
            <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-[var(--muted)]">
              {turns.length} turn{turns.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-3 flex-1 space-y-4 overflow-y-auto pr-1">
            {turns.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-white/70 px-4 py-5 text-sm text-[var(--muted)]">
                Ask a question to start. Replies, auth, settings, and runtime behavior all come from the shared browser core.
              </div>
            ) : (
              turns.map((turn, index) => (
                <div key={turn.id} className="space-y-2">
                  {turn.userText ? (
                    <p className="rounded-2xl bg-amber-100/80 px-3 py-2.5 text-sm text-stone-900">{turn.userText}</p>
                  ) : null}

                  {turn.notice ? (
                    <div className={`rounded-2xl border px-3 py-2 text-sm ${noticeStyle[turn.notice.level ?? 'info']}`}>
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

                  {turn.assistantContent ? (
                    <div className="rounded-2xl bg-white px-3 py-3 text-sm text-stone-900 shadow-sm">
                      <AssistantContent
                        content={turn.assistantContent}
                        className="prose-assistant"
                        isStreaming={turn.isStreaming}
                        turnId={turn.id}
                      />
                    </div>
                  ) : isRunning ? (
                    <div className="rounded-2xl bg-white px-3 py-3 text-sm text-stone-400 shadow-sm">
                      <ThinkingDots />
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <div ref={conversationEndRef} />
          </div>
        </section>

        <form
          className="px-1 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSubmit()
              }
            }}
            placeholder="Ask anything…"
            rows={1}
            className="w-full resize-none rounded-2xl border border-stone-300 bg-white px-3 py-3 text-base leading-relaxed outline-none ring-amber-300 transition focus:ring-2"
            style={{ minHeight: '52px' }}
          />

          <div className="mt-3 flex items-center justify-between gap-2">
            {/* Left: settings, sign in, reset */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Settings"
                title="Settings"
                onClick={() => setSettingsOpen(true)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-700"
              >
                <FaGear className="h-4 w-4" aria-hidden="true" />
              </button>

              {!token ? (
                <button
                  type="button"
                  aria-label="Sign in with GitHub"
                  title="Sign in with GitHub"
                  onClick={() => setSettingsOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800"
                >
                  <FaGithub className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              <button
                type="button"
                aria-label="Reset conversation"
                title="Reset conversation"
                onClick={() => void resetConversation()}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
              >
                <FaRotateLeft className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* Right: microphone, send */}
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
                  className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    speech.listening
                      ? 'border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800'
                  }`}
                >
                  <FaMicrophone className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}

              {isRetryPending && isCoolingDown ? (
                <Button type="button" variant="secondary" onClick={cancelRetry} className="rounded-full">
                  Cancel retry
                </Button>
              ) : null}

              <Button
                type="submit"
                aria-label={isCoolingDown ? `Wait ${submitLabel}` : isRunning ? 'Thinking…' : 'Send'}
                title={isCoolingDown ? `Wait ${submitLabel}` : isRunning ? 'Thinking…' : 'Send'}
                disabled={isRunning || isCoolingDown || !prompt.trim()}
                className="h-10 min-w-10 rounded-full px-2"
              >
                {isCoolingDown ? (
                  <span className="text-xs tabular-nums">{submitLabel}</span>
                ) : isRunning ? (
                  <FaSpinner className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FaArrowUp className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
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
        <Suspense fallback={<MobilePanelLoading />}>
          <LazyBrowserSettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      ) : null}

      <PermissionModal />
    </div>
  )
}
