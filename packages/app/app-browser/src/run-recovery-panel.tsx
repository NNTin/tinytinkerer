import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { useOptionalBrowserApp, type BrowserApp } from './app'
import { parseCheckpoint } from './runtime/run-checkpoint'

type RecoveryView = { message: string; action?: string }

const plural = (count: number) => `${count} completed tool call${count === 1 ? '' : 's'}`

/**
 * Saved progress of the latest turn's run and its explicit Resume action
 * (issue #531), rendered by TurnChrome for the latest turn only and loaded
 * lazily (see `RunRecovery` in turn-activity-panel.tsx).
 *
 * It reads the record only to describe it; whether a Resume may proceed is
 * decided when it runs, against the current session's tools and access, and a
 * refusal is persisted there and shown here. Nothing resumes on its own.
 */
export default function RunRecoveryPanel(props: { turnId: string; prompt: string }) {
  // Outside an app (component tests) or with no checkpoint storage, there is
  // nothing to resume.
  const app = useOptionalBrowserApp()
  return app?.shell.loadRunCheckpoints ? <Recovery {...props} app={app} /> : null
}

const Recovery = ({ turnId, prompt, app }: { turnId: string; prompt: string; app: BrowserApp }) => {
  const load = app.shell.loadRunCheckpoints
  const chat = app.stores.chat
  const conversationId = useStore(chat, (state) => state.conversationId)
  const isRunning = useStore(chat, (state) => state.isRunning)
  const eventCount = useStore(chat, (state) => state.events.length)
  const cooldownUntil = useStore(chat, (state) => state.cooldownUntil)
  const resumeRun = useStore(chat, (state) => state.resumeRun)
  const [view, setView] = useState<RecoveryView>()
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    setRequested(false)
    if (!load || !conversationId || isRunning) return setView(undefined)
    let current = true
    void load()
      .then((store) => store.get(conversationId))
      .then((raw) => {
        const parsed = parseCheckpoint(raw)
        let next: RecoveryView | undefined
        if (parsed && !parsed.ok) {
          next = { message: `Saved progress cannot be resumed: ${parsed.reason}` }
        } else if (parsed && parsed.checkpoint.turnId === turnId) {
          const { blocked, invocations, inFlight } = parsed.checkpoint
          const done = plural(invocations.filter((call) => call.outcome.ok).length)
          next = blocked
            ? {
                message: `Resume unavailable: ${blocked.reason}`,
                ...(blocked.retryable ? { action: 'Try Resume again' } : {})
              }
            : {
                message: inFlight
                  ? `Saved progress: ${done}. The last call (${inFlight.toolId}) was sent, but its result was not saved; Resume checks it first and stops if its outcome cannot be confirmed.`
                  : `Saved progress: ${done}. Resume continues from the unfinished step without repeating them.`,
                action: 'Resume'
              }
        }
        if (current) setView(next)
      })
      .catch(() => current && setView(undefined))
    return () => {
      current = false
    }
  }, [load, conversationId, turnId, isRunning, eventCount])

  if (!view || isRunning) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] px-2 py-1.5 text-[11px] text-[var(--muted)]">
      <p className="min-w-0 flex-1">{view.message}</p>
      {view.action ? (
        <button
          type="button"
          disabled={requested || Date.parse(cooldownUntil ?? '') > Date.now()}
          onClick={() => {
            setRequested(true)
            void resumeRun(prompt, turnId, conversationId)
          }}
          className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[var(--text)] hover:bg-[var(--panel-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {view.action}
        </button>
      ) : null}
    </div>
  )
}
