import type { ChatEvent } from '@tinytinkerer/types'
import { Button } from '@tinytinkerer/ui'
import * as Collapsible from '@radix-ui/react-collapsible'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '../../components/top-bar'
import { useChatStore } from '../../stores/chat-store'
import { MarkdownContent } from './markdown-content.js'

// Guard so the deferred-load init only fires once even in React StrictMode.
let chatStoreInitialized = false

type TimelineEntry = {
  id: string
  label: string
}

type Turn = {
  id: string
  userText: string
  assistantText: string
  isError?: boolean
  errorMessage?: string
  systemMessage?: string
  systemLevel?: 'info' | 'warning' | 'error'
  rateLimitMessage?: string
}

const thinkingLabel = (event: ChatEvent): string | undefined => {
  switch (event.type) {
    case 'planning.started':
      return 'Planning research steps'
    case 'execution.step.started':
      return event.payload.step.summary
    case 'tool.call.started': {
      const query = event.payload.input.query
      return typeof query === 'string' ? `Searching: ${query}` : 'Searching web'
    }
    case 'execution.step.completed':
      return event.payload.note
    default:
      return undefined
  }
}

// streamingText holds the live chunk accumulation from the store; assistant.chunk
// events are not persisted so completed turns rely solely on assistant.done.text.
const buildTurns = (events: ChatEvent[], streamingText: string): Turn[] => {
  const turns: Turn[] = []
  let userEventId: string | null = null
  let userText: string | null = null

  for (const event of events) {
    if (event.type === 'user.message') {
      userEventId = event.id
      userText = event.payload.text
    } else if (event.type === 'assistant.done') {
      if (userEventId !== null && userText !== null) {
        turns.push({ id: userEventId, userText, assistantText: event.payload.text })
        userEventId = null
        userText = null
      }
    } else if (event.type === 'error') {
      if (userEventId !== null && userText !== null) {
        turns.push({
          id: userEventId,
          userText,
          assistantText: '',
          isError: true,
          errorMessage: event.payload.message
        })
        userEventId = null
        userText = null
      }
    } else if (event.type === 'system') {
      if (userEventId !== null && userText !== null) {
        turns.push({
          id: userEventId,
          userText,
          assistantText: '',
          systemMessage: event.payload.message,
          systemLevel: event.payload.level
        })
      } else {
        turns.push({
          id: event.id,
          userText: '',
          assistantText: '',
          systemMessage: event.payload.message,
          systemLevel: event.payload.level
        })
      }
    } else if (event.type === 'rate.limit.waiting') {
      if (userEventId !== null && userText !== null) {
        turns.push({
          id: userEventId,
          userText,
          assistantText: '',
          rateLimitMessage: event.payload.message
        })
      }
    }
  }

  // In-progress turn: use live streamingText from the store.
  if (userEventId !== null && userText !== null) {
    turns.push({ id: userEventId, userText, assistantText: streamingText })
  }

  return turns
}

const buildCurrentTimeline = (events: ChatEvent[]): TimelineEntry[] => {
  let startIndex = 0
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.type === 'user.message') {
      startIndex = i
      break
    }
  }
  return events
    .slice(startIndex)
    .map((event) => {
      const label = thinkingLabel(event)
      return label ? { id: event.id, label } : undefined
    })
    .filter((value): value is TimelineEntry => Boolean(value))
}

const formatCooldown = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const ThinkingDots = () => (
  <span aria-label="Thinking" className="inline-flex items-end gap-0.5 pb-0.5">
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-stone-400" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-stone-400" />
    <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-stone-400" />
  </span>
)

const systemLevelStyle: Record<'info' | 'warning' | 'error', string> = {
  info: 'border-stone-200 bg-stone-50 text-stone-600',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-rose-200 bg-rose-50 text-rose-700'
}

export const ChatPage = () => {
  const events = useChatStore((state) => state.events)
  const streamingText = useChatStore((state) => state.streamingText)
  const isRunning = useChatStore((state) => state.isRunning)
  const isRetryPending = useChatStore((state) => state.isRetryPending)
  const cooldownUntil = useChatStore((state) => state.cooldownUntil)
  const sendPrompt = useChatStore((state) => state.sendPrompt)
  const resetConversation = useChatStore((state) => state.resetConversation)
  const cancelRetry = useChatStore((state) => state.cancelRetry)

  const [prompt, setPrompt] = useState('')
  const [openTimeline, setOpenTimeline] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const conversationEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!chatStoreInitialized) {
      chatStoreInitialized = true
      void useChatStore.getState().initialize()
    }
  }, [])

  useEffect(() => {
    if (!cooldownUntil) {
      return undefined
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [cooldownUntil])

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
  }, [events, streamingText])

  const turns = useMemo(() => buildTurns(events, streamingText), [events, streamingText])
  const timeline = useMemo(() => buildCurrentTimeline(events), [events])

  const toolEvents = useMemo(
    () => events.filter((event) => event.type === 'tool.call.completed' || event.type === 'tool.call.failed'),
    [events]
  )

  const cooldownRemainingMs = cooldownUntil ? Math.max(0, Date.parse(cooldownUntil) - now) : 0
  const isCoolingDown = cooldownRemainingMs > 0
  const submitLabel = isCoolingDown
    ? formatCooldown(cooldownRemainingMs)
    : isRunning
      ? 'Thinking…'
      : 'Send'

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!prompt.trim() || isCoolingDown || isRunning) return
      void sendPrompt(prompt.trim())
      setPrompt('')
    }
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-5xl flex-col">
      <TopBar />

      <main className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-6 md:px-8">
        {/* Conversation */}
        <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
          <h2 className="shrink-0 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Conversation</h2>
          <div className="mt-3 flex-1 overflow-y-auto space-y-4">
            {turns.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Start a conversation below.</p>
            ) : (
              turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  {turn.userText ? (
                    <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-stone-800">{turn.userText}</p>
                  ) : null}

                  {turn.systemMessage ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-sm ${systemLevelStyle[turn.systemLevel ?? 'info']}`}
                    >
                      {turn.systemMessage}
                    </div>
                  ) : turn.isError && turn.errorMessage ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {turn.errorMessage}
                    </div>
                  ) : turn.rateLimitMessage ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      {turn.rateLimitMessage}
                    </div>
                  ) : turn.assistantText ? (
                    <div className="rounded-lg bg-white px-3 py-2 text-sm text-stone-900 shadow-sm">
                      <MarkdownContent
                        content={turn.assistantText}
                        isStreaming={Boolean(streamingText && turn.assistantText === streamingText)}
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
        <Collapsible.Root open={openTimeline} onOpenChange={setOpenTimeline}>
          <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Thinking timeline</h2>
              <Collapsible.Trigger asChild>
                <Button variant="ghost" size="sm" aria-label="Toggle timeline">
                  {openTimeline ? 'Collapse' : 'Expand'}
                </Button>
              </Collapsible.Trigger>
            </div>
            <Collapsible.Content className="collapsible-content overflow-hidden">
              <div className="mt-3 space-y-2 text-sm">
                {timeline.length === 0 ? (
                  <p className="text-[var(--muted)]">
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
                      className="timeline-entry flex items-start gap-2.5 rounded-md border border-stone-200 bg-white px-3 py-2"
                    >
                      <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-700">
                        {index + 1}
                      </span>
                      <span className="text-stone-700">{item.label}</span>
                    </div>
                  ))
                )}
              </div>
            </Collapsible.Content>
          </section>
        </Collapsible.Root>

        {/* Tool activity */}
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Tool activity</h2>
          <div className="mt-3 space-y-2">
            {toolEvents.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Search results and tool outputs will appear here.</p>
            ) : (
              toolEvents.map((event) => {
                if (event.type === 'tool.call.failed') {
                  return (
                    <div key={event.id} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      <span className="font-medium">Search failed:</span> {event.payload.error}
                    </div>
                  )
                }

                const output = event.payload.output as { query?: string; results?: unknown[] }
                const resultCount = Array.isArray(output.results) ? output.results.length : 0

                return (
                  <details key={event.id} className="group rounded-md border border-stone-200 bg-white text-sm">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-stone-700 hover:bg-stone-50">
                      <span className="flex h-4 w-4 items-center justify-center rounded bg-stone-100 text-[10px] font-bold text-stone-500 transition-transform group-open:rotate-90">
                        ▶
                      </span>
                      <span>
                        Web search —{' '}
                        <span className="text-stone-500">{resultCount} result{resultCount !== 1 ? 's' : ''}</span>
                      </span>
                    </summary>
                    <div className="border-t border-stone-100 px-3 py-2 text-stone-500">
                      Query: <span className="text-stone-700">{output.query ?? 'unknown'}</span>
                    </div>
                  </details>
                )
              })
            )}
          </div>
        </section>

        {/* Compose */}
        <form
          className="mt-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm"
          onSubmit={(event) => {
            event.preventDefault()
            if (!prompt.trim() || isCoolingDown || isRunning) {
              return
            }
            void sendPrompt(prompt.trim())
            setPrompt('')
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
          <div className="mt-2 flex items-center gap-2">
            <Button type="submit" disabled={isRunning || isCoolingDown || !prompt.trim()} className="min-w-24">
              {submitLabel}
            </Button>
            {isRetryPending && isCoolingDown ? (
              <Button type="button" variant="secondary" onClick={cancelRetry}>
                Cancel retry
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => void resetConversation()}>
              Reset
            </Button>
          </div>
        </form>
      </main>
    </div>
  )
}
