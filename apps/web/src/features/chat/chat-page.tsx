import type { ChatEvent } from '@tinytinkerer/types'
import { Button } from '@tinytinkerer/ui'
import * as Collapsible from '@radix-ui/react-collapsible'
import { useMemo, useState } from 'react'
import { TopBar } from '../../components/top-bar'
import { useChatRuntime } from '../../hooks/use-chat-runtime'

type TimelineEntry = {
  id: string
  label: string
}

const thinkingLabels = (event: ChatEvent): string | undefined => {
  switch (event.type) {
    case 'planning.started':
      return 'Planning research steps'
    case 'execution.step.started':
      return event.payload.step.summary
    case 'tool.call.started':
      return `Searching web: ${event.payload.toolId}`
    case 'execution.step.completed':
      return event.payload.note
    default:
      return undefined
  }
}

const summarizeAssistant = (events: ChatEvent[]): string =>
  events
    .filter((event) => event.type === 'assistant.chunk')
    .map((event) => event.payload.text)
    .join('')
    .trim()

export const ChatPage = () => {
  const { events, sendPrompt, resetConversation, isRunning } = useChatRuntime()
  const [prompt, setPrompt] = useState('')
  const [openTimeline, setOpenTimeline] = useState(true)

  const timeline = useMemo<TimelineEntry[]>(
    () =>
      events
        .map((event) => {
          const label = thinkingLabels(event)
          if (!label) {
            return undefined
          }

          return { id: event.id, label }
        })
        .filter((value): value is TimelineEntry => Boolean(value)),
    [events]
  )

  const assistantText = useMemo(() => summarizeAssistant(events), [events])

  const toolEvents = useMemo(
    () => events.filter((event) => event.type === 'tool.call.completed' || event.type === 'tool.call.failed'),
    [events]
  )

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col">
      <TopBar />

      <main className="flex flex-1 flex-col gap-4 px-4 py-6 md:px-8">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm transition-all duration-300">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Conversation</h2>
          <div className="mt-3 space-y-3">
            {events
              .filter((event) => event.type === 'user.message')
              .map((event) => (
                <p key={event.id} className="rounded-lg bg-amber-100/70 px-3 py-2 text-sm text-stone-800">
                  {event.payload.text}
                </p>
              ))}
            {assistantText ? (
              <p className="rounded-lg bg-white px-3 py-2 text-sm text-stone-900 shadow-sm">{assistantText}</p>
            ) : (
              <p className="text-sm text-[var(--muted)]">Assistant responses stream here.</p>
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
          className="mt-auto grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 shadow-sm md:grid-cols-[1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            if (!prompt.trim()) {
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
          <Button type="submit" disabled={isRunning || !prompt.trim()}>
            {isRunning ? 'Thinking…' : 'Send'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void resetConversation()}>
            Reset
          </Button>
        </form>
      </main>
    </div>
  )
}
