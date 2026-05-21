import type { ChatEvent } from '@tinytinkerer/types'
import { Button } from '@tinytinkerer/ui'
import * as Collapsible from '@radix-ui/react-collapsible'
import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '../../components/top-bar'
import { useChatStore } from '../../stores/chat-store'

type TimelineEntry = {
  id: string
  label: string
}

type Turn = {
  id: string
  userText: string
  assistantText: string
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

  useEffect(() => {
    if (!cooldownUntil) {
      return undefined
    }

    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [cooldownUntil])

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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col">
      <TopBar />

      <main className="flex flex-1 flex-col gap-4 px-4 py-6 md:px-8">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm transition-all duration-300">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Conversation</h2>
          <div className="mt-3 space-y-4">
            {turns.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Your conversation appears here.</p>
            ) : (
              turns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  <p className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-stone-800">{turn.userText}</p>
                  {turn.assistantText ? (
                    <p className="rounded-lg bg-white px-3 py-2 text-sm text-stone-900 shadow-sm">
                      {turn.assistantText}
                    </p>
                  ) : isRunning ? (
                    <p className="rounded-lg bg-white px-3 py-2 text-sm text-[var(--muted)] shadow-sm">Thinking…</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

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
            <Collapsible.Content className="mt-3 space-y-2 text-sm">
              {timeline.length === 0 ? (
                <p className="text-[var(--muted)]">Understanding request</p>
              ) : (
                timeline.map((item) => (
                  <div key={item.id} className="rounded-md border border-stone-200 bg-white px-3 py-2">
                    {item.label}
                  </div>
                ))
              )}
            </Collapsible.Content>
          </section>
        </Collapsible.Root>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Tool activity</h2>
          <div className="mt-3 space-y-2">
            {toolEvents.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Tool execution cards appear here.</p>
            ) : (
              toolEvents.map((event) => {
                if (event.type === 'tool.call.failed') {
                  return (
                    <div key={event.id} className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm">
                      Web Search failed: {event.payload.error}
                    </div>
                  )
                }

                const output = event.payload.output as { query?: string; results?: unknown[] }
                const resultCount = Array.isArray(output.results) ? output.results.length : 0

                return (
                  <details key={event.id} className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm">
                    <summary className="cursor-pointer">Web Search — {resultCount} results found</summary>
                    <p className="mt-1 text-[var(--muted)]">Query: {output.query ?? 'unknown'}</p>
                  </details>
                )
              })
            )}
          </div>
        </section>

        <form
          className="mt-auto grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm md:grid-cols-[1fr_auto_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            if (!prompt.trim() || isCoolingDown || isRunning) {
              return
            }
            void sendPrompt(prompt.trim())
            setPrompt('')
          }}
        >
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask anything…"
            className="h-11 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none ring-amber-300 transition focus:ring-2"
          />
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
        </form>
      </main>
    </div>
  )
}
