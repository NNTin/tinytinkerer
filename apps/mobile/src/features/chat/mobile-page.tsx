import {
  AssistantContent,
  useChatSurfaceController,
  useSettingsStore
} from '@tinytinkerer/app-browser'
import { Button, GitHubMark, ThinkingDots } from '@tinytinkerer/ui'
import * as Collapsible from '@radix-ui/react-collapsible'
import { ArrowDownTrayIcon, Cog6ToothIcon } from '@heroicons/react/24/outline'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { MobileChatLoading, MobilePanelLoading } from '../../app/loading-screen'
import { useInstallPrompt } from '../install/use-install-prompt'

const SettingsModal = lazy(() =>
  import('@tinytinkerer/app-browser/browser-settings-modal').then((module) => ({
    default: module.BrowserSettingsModal
  }))
)

const toolLabel = (toolId: string, serverNameById: Map<string, string>): string => {
  if (toolId === 'web-search') return 'Web search'
  const mcpMatch = toolId.match(/^mcp:([^:]+):(.+)$/)
  if (mcpMatch) {
    const [, serverId, toolName] = mcpMatch
    const serverName = serverNameById.get(serverId ?? '')
    return serverName ? `[${serverName}] ${toolName}` : (toolName ?? toolId)
  }
  return toolId
}

const noticeStyle: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-stone-200 bg-stone-50 text-stone-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700'
}

export const MobilePage = () => {
  const {
    isBooting,
    events,
    token,
    turns,
    timeline,
    toolEvents,
    isRunning,
    isRetryPending,
    showThinkingTimeline,
    showToolActivity,
    submitLabel,
    isCoolingDown,
    submitPrompt: submitPromptController,
    resetConversation,
    cancelRetry
  } = useChatSurfaceController()
  const mcpServers = useSettingsStore((state) => state.mcpServers)
  const serverNameById = useMemo(
    () => new Map(mcpServers.map((s) => [s.id, s.name])),
    [mcpServers]
  )
  const [prompt, setPrompt] = useState('')
  const [openTimeline, setOpenTimeline] = useState(true)
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

  const handlePromptSubmit = () => {
    void submitPromptController(prompt).then((didSend) => {
      if (didSend) {
        setPrompt('')
      }
    })
  }

  if (isBooting) {
    return <MobileChatLoading />
  }

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-screen-sm flex-col bg-[var(--bg)] text-[var(--text)]">
      <header className="px-4 pb-3 pt-[max(env(safe-area-inset-top),1rem)]">
        <div className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] px-4 py-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Mobile PWA</p>
              <h1 className="mt-1 text-xl font-semibold text-stone-900">tinytinkerer</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Hash-routed, installable, and tuned for quick sessions on narrow screens.
              </p>
            </div>
            <button
              type="button"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-stone-200 bg-white text-stone-500 shadow-sm transition-colors hover:border-stone-300 hover:text-stone-700"
            >
              <Cog6ToothIcon className="h-5 w-5" />
            </button>
          </div>

          {canInstall || showIosHint ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <div className="min-w-0 flex-1">
                <p className="font-medium">Install tinytinkerer</p>
                <p className="mt-1 text-xs text-amber-800">
                  {canInstall
                    ? 'Add the app to your home screen for faster launches and offline-ready shell assets.'
                    : 'On iPhone or iPad, use Share → Add to Home Screen to install this app.'}
                </p>
              </div>
              {canInstall ? (
                <Button type="button" size="sm" className="rounded-full" onClick={() => void promptToInstall()}>
                  <ArrowDownTrayIcon className="mr-1 h-4 w-4" />
                  Install app
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <section className="flex min-h-0 flex-1 flex-col rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] px-4 py-4 shadow-sm">
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
              turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  {turn.userText ? (
                    <p className="rounded-2xl bg-amber-100/80 px-3 py-2.5 text-sm text-stone-900">{turn.userText}</p>
                  ) : null}

                  {turn.notice ? (
                    <div className={`rounded-2xl border px-3 py-2 text-sm ${noticeStyle[turn.notice.level ?? 'info']}`}>
                      {turn.notice.message}
                    </div>
                  ) : null}

                  {turn.assistantContent ? (
                    <div className="rounded-2xl bg-white px-3 py-3 text-sm text-stone-900 shadow-sm">
                      <AssistantContent
                        content={turn.assistantContent}
                        className="prose-assistant"
                        isStreaming={turn.isStreaming}
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

        {showThinkingTimeline ? (
          <Collapsible.Root open={openTimeline} onOpenChange={setOpenTimeline}>
            <section className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Thinking</h2>
                <Collapsible.Trigger asChild>
                  <button type="button" className="text-xs text-[var(--muted)] transition-colors hover:text-stone-700">
                    {openTimeline ? 'Collapse' : 'Expand'}
                  </button>
                </Collapsible.Trigger>
              </div>
              <Collapsible.Content className="collapsible-content overflow-hidden">
                <div className="mt-2 space-y-1 text-sm">
                  {timeline.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">
                      {isRunning ? (
                        <>
                          Understanding request <ThinkingDots />
                        </>
                      ) : (
                        'Steps will appear here during a run.'
                      )}
                    </p>
                  ) : (
                    timeline.map((item, index) => (
                      <div key={item.id} className="timeline-entry flex items-start gap-2 py-1">
                        <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[9px] font-semibold text-amber-700">
                          {index + 1}
                        </span>
                        <span className="text-xs text-stone-600">{item.label}</span>
                      </div>
                    ))
                  )}
                </div>
              </Collapsible.Content>
            </section>
          </Collapsible.Root>
        ) : null}

        {showToolActivity ? (
          <section className="rounded-[1.25rem] border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Tool History</h2>
              <p className="text-[11px] text-[var(--muted)]">Conversation audit trail</p>
            </div>
            <div className="mt-2 space-y-1">
              {toolEvents.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">Searches and tool runs will appear here during the session.</p>
              ) : (
                toolEvents.map((event) => {
                  const toolId = event.payload.toolId
                  const label = toolLabel(toolId, serverNameById)

                  if (event.type === 'tool.call.failed') {
                    return (
                      <div key={event.id} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                        <span className="font-medium">{label} failed:</span> {event.payload.error}
                      </div>
                    )
                  }

                  if (toolId === 'web-search') {
                    const output = event.payload.output as { query?: string; results?: unknown[] }
                    const resultCount = Array.isArray(output.results) ? output.results.length : 0
                    return (
                      <details key={event.id} className="group rounded-md border border-stone-200/70 bg-white/70 text-xs">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-stone-600 hover:bg-stone-50/80">
                          <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-stone-100 text-[9px] font-bold text-stone-400 transition-transform group-open:rotate-90">
                            ▶
                          </span>
                          <span>
                            Web search —{' '}
                            <span className="text-[var(--muted)]">{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
                          </span>
                        </summary>
                        <div className="border-t border-stone-100 px-3 py-1.5 text-[var(--muted)]">
                          Query: <span className="text-stone-600">{output.query ?? 'unknown'}</span>
                        </div>
                      </details>
                    )
                  }

                  const mcpOutput = event.type === 'tool.call.completed'
                    ? event.payload.output as { text?: string } | null
                    : null
                  const summary = mcpOutput?.text ? mcpOutput.text.slice(0, 120) : '(no output)'
                  return (
                    <details key={event.id} className="group rounded-md border border-stone-200/70 bg-white/70 text-xs">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-stone-600 hover:bg-stone-50/80">
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-stone-100 text-[9px] font-bold text-stone-400 transition-transform group-open:rotate-90">
                          ▶
                        </span>
                        <span>{label}</span>
                      </summary>
                      <div className="border-t border-stone-100 px-3 py-1.5 text-[var(--muted)]">
                        {summary}
                      </div>
                    </details>
                  )
                })
              )}
            </div>
          </section>
        ) : null}

        <form
          className="rounded-[1.5rem] border border-[var(--border)] bg-[var(--panel)] px-3 py-3 shadow-[0_18px_40px_rgba(36,33,24,0.08)]"
          onSubmit={(event) => {
            event.preventDefault()
            handlePromptSubmit()
          }}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handlePromptSubmit()
              }
            }}
            placeholder="Ask anything…"
            rows={1}
            className="w-full resize-none rounded-2xl border border-stone-300 bg-white px-3 py-3 text-base leading-relaxed outline-none ring-amber-300 transition focus:ring-2"
            style={{ minHeight: '52px' }}
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!token ? (
              <button
                type="button"
                aria-label="Sign in with GitHub"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800"
              >
                <GitHubMark />
                Sign in
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void resetConversation()}
              className="inline-flex h-10 items-center rounded-full border border-stone-300 bg-white px-3 text-sm text-stone-600 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
            >
              Reset
            </button>

            {isRetryPending && isCoolingDown ? (
              <Button type="button" variant="secondary" onClick={cancelRetry} className="rounded-full">
                Cancel retry
              </Button>
            ) : null}

            <div className="ml-auto" />

            <Button type="submit" disabled={isRunning || isCoolingDown || !prompt.trim()} className="min-w-24 rounded-full">
              {submitLabel}
            </Button>
          </div>
        </form>
      </main>

      {settingsOpen ? (
        <Suspense fallback={<MobilePanelLoading />}>
          <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}
