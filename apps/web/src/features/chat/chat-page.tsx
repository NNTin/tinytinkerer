import {
  AssistantContent,
  useChatSurfaceController,
  useSettingsStore
} from '@tinytinkerer/app-browser'
import { Button, GitHubMark, ThinkingDots } from '@tinytinkerer/ui'
import * as Collapsible from '@radix-ui/react-collapsible'
import { Cog6ToothIcon } from '@heroicons/react/24/outline'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { WebChatLoading, WebPanelLoading } from '../../app/loading-screen'

const SettingsModal = lazy(() =>
  import('@tinytinkerer/app-browser').then((module) => ({
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

const systemLevelStyle: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-stone-200 bg-stone-50 text-stone-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700'
}

const noticeStyle: Record<'info' | 'warning' | 'error', string> = systemLevelStyle

export const ChatPage = () => {
  const {
    isBooting,
    initializeError,
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
    submitPrompt,
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

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [prompt])

  // Scroll to bottom when new content arrives
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const handlePromptSubmit = () => {
    void submitPrompt(prompt).then((didSend) => {
      if (didSend) {
        setPrompt('')
      }
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handlePromptSubmit()
    }
  }

  if (isBooting || initializeError) {
    return <WebChatLoading {...(initializeError ? { error: initializeError } : {})} />
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-5xl flex-col">
      <main className="flex flex-1 flex-col gap-3 overflow-hidden px-4 py-4 md:px-8">
        {/* Conversation */}
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
          <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Conversation</h2>
          <div className="mt-3 flex-1 overflow-y-auto space-y-4">
            {turns.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Start a conversation below.</p>
            ) : (
              turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  {turn.userText ? (
                    <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-stone-800">{turn.userText}</p>
                  ) : null}

                  {turn.notice ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-sm ${noticeStyle[turn.notice.level ?? 'info']}`}
                    >
                      {turn.notice.message}
                    </div>
                  ) : null}

                  {turn.assistantContent ? (
                    <div className="rounded-lg bg-white px-3 py-2 text-sm text-stone-900 shadow-sm">
                      <AssistantContent
                        content={turn.assistantContent}
                        className="prose-assistant"
                        isStreaming={turn.isStreaming}
                      />
                    </div>
                  ) : isRunning ? (
                    <div className="rounded-lg bg-white px-3 py-2.5 text-sm text-stone-400 shadow-sm">
                      <ThinkingDots />
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <div ref={conversationEndRef} />
          </div>
        </section>

        {/* Thinking timeline */}
        {showThinkingTimeline ? (
          <Collapsible.Root open={openTimeline} onOpenChange={setOpenTimeline}>
            <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Thinking</h2>
                <Collapsible.Trigger asChild>
                  <button
                    type="button"
                    aria-label="Toggle timeline"
                    className="text-xs text-[var(--muted)] hover:text-stone-700 transition-colors"
                  >
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
                      <div
                        key={item.id}
                        className="timeline-entry flex items-start gap-2 py-1"
                      >
                        <span className="mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[9px] font-semibold text-amber-700">
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

        {/* Tool activity */}
        {showToolActivity ? (
          <section className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">Tool History</h2>
              <p className="text-[11px] text-[var(--muted)]">Historical audit log across this conversation</p>
            </div>
            <div className="mt-2 space-y-1">
              {toolEvents.length === 0 ? (
                <p className="text-xs text-[var(--muted)]">Search results and tool outputs from this conversation will appear here.</p>
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
                      <details key={event.id} className="group rounded-md border border-stone-200/70 bg-white/60 text-xs">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-stone-600 hover:bg-stone-50/80">
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
                    ? event.payload.output as { text?: string; isError?: boolean } | null
                    : null
                  const isMcpError = mcpOutput?.isError === true
                  const summaryText = mcpOutput?.text ? mcpOutput.text.slice(0, 120) : '(no output)'
                  const summary = isMcpError ? `Error: ${summaryText}` : summaryText
                  return (
                    <details
                      key={event.id}
                      className={`group rounded-md border text-xs ${isMcpError ? 'border-rose-200 bg-rose-50/70' : 'border-stone-200/70 bg-white/60'}`}
                    >
                      <summary
                        className={`flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 hover:bg-stone-50/80 ${isMcpError ? 'text-rose-700' : 'text-stone-600'}`}
                      >
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-stone-100 text-[9px] font-bold text-stone-400 transition-transform group-open:rotate-90">
                          ▶
                        </span>
                        <span>{label}</span>
                      </summary>
                      <div
                        className={`border-t px-3 py-1.5 ${isMcpError ? 'border-rose-100 text-rose-700' : 'border-stone-100 text-[var(--muted)]'}`}
                      >
                        {summary}
                      </div>
                    </details>
                  )
                })
              )}
            </div>
          </section>
        ) : null}

        {/* Composer */}
        <form
          className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault()
            handlePromptSubmit()
          }}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="w-full resize-none rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm leading-relaxed outline-none ring-amber-300 transition focus:ring-2"
            style={{ minHeight: '44px' }}
          />

          {/* Composer actions */}
          <div className="mt-2 flex items-center gap-2">
            {/* Settings trigger */}
            <button
              type="button"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 text-stone-500 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-700 transition-colors"
            >
              <Cog6ToothIcon className="h-4 w-4" />
            </button>

            {/* Auth entry point — visible only when not signed in */}
            {!token ? (
              <button
                type="button"
                aria-label="Sign in with GitHub"
                onClick={() => setSettingsOpen(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 text-xs text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-800 transition-colors"
              >
                <GitHubMark />
                Sign in
              </button>
            ) : null}

            <div className="flex-1" />

            {/* Reset */}
            <button
              type="button"
              onClick={() => void resetConversation()}
              className="inline-flex h-9 items-center rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 transition-colors"
            >
              Reset
            </button>

            {/* Retry cancel */}
            {isRetryPending && isCoolingDown ? (
              <Button type="button" variant="secondary" onClick={cancelRetry}>
                Cancel retry
              </Button>
            ) : null}

            {/* Send */}
            <Button type="submit" disabled={isRunning || isCoolingDown || !prompt.trim()} className="min-w-24">
              {submitLabel}
            </Button>
          </div>
        </form>
      </main>

      {settingsOpen ? (
        <Suspense fallback={<WebPanelLoading />}>
          <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}
