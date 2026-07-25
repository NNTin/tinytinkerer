import { useId, useMemo, useState } from 'react'
import {
  AssistantContent,
  buildTurns,
  ContextInspectorSlot,
  formatCooldown,
  TurnActivityPanel,
  useChatComposer,
  useChatStore,
  useChatSurfaceController,
  useContextInspector,
  useSettingsStore,
  type ChatEvent,
  type InspectorEntry
} from '@tinytinkerer/app-browser'
import {
  conversationActivityStatus,
  type PixelAgentsConversation
} from '@tinytinkerer/pixel-agents'
import { LiveStatusBadge, RunOutcomeBadge } from './RunOutcomeBadge'
import { deriveRunOutcome, requestsForRun, splitEventsIntoRuns, type RunOutcome } from './trace'

type TraceRun = {
  key: string
  events: ChatEvent[]
  isLive: boolean
  outcome: RunOutcome | null
  requests: InspectorEntry[]
}

const requestSummary = (entry: InspectorEntry): string => {
  const toolCount = entry.request.tools?.length ?? 0
  const toolsLabel =
    toolCount > 0
      ? `${toolCount} tool${toolCount === 1 ? '' : 's'} available (${(entry.request.tools ?? [])
          .map((tool) => tool.function.name)
          .join(', ')})`
      : 'no tools advertised'
  const messageCount = entry.request.messages.length
  return `Model ${entry.request.model} · ${messageCount} message${messageCount === 1 ? '' : 's'} · ${toolsLabel}`
}

// Accept a prompt, run it through the real docs-isolated TinyTinkerer runtime
// (via the SAME `useChatSurfaceController`/`useChatComposer` contract every
// other chat surface uses — web, mobile, widget), and render an ordered,
// expandable trace built entirely from the resulting ChatEvent stream and the
// existing turn-activity/inspector contracts (issue #454) — there is no
// parallel instrumentation format. This is the `assistant` pane
// ExecutionTraceLabContent hands to PixelAgentsStage, so the trace always
// describes the SAME conversation the Pixel Agents office shows.
export const ExecutionTracePanel = (): React.JSX.Element => {
  const composerId = useId()
  const controller = useChatSurfaceController()
  const composer = useChatComposer(controller.submitPrompt)
  const { entries: requestEntries } = useContextInspector()
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const agentType = useSettingsStore((state) => state.agentType)
  const activeConversationId = useChatStore((state) => state.conversationId)

  // Keyed by a run's leading event id. The runtime emits no distinct
  // "cancelled" ChatEvent for a Stop click (see trace.ts's deriveRunOutcome
  // doc comment), so remembering WHICH run a Stop targeted is state only this
  // composer can supply.
  const [cancelledRunKeys, setCancelledRunKeys] = useState<ReadonlySet<string>>(() => new Set())

  const eventRuns = useMemo(() => splitEventsIntoRuns(controller.events), [controller.events])

  const traceRuns = useMemo<TraceRun[]>(
    () =>
      eventRuns.map((runEvents, index) => {
        const key = runEvents[0]?.id ?? `run-${index}`
        const isLive = index === eventRuns.length - 1 && controller.isRunning
        const startIso = runEvents[0]?.timestamp
        const nextRunStartIso = eventRuns[index + 1]?.[0]?.timestamp ?? null
        return {
          key,
          events: runEvents,
          isLive,
          outcome:
            isLive || !startIso ? null : deriveRunOutcome(runEvents, cancelledRunKeys.has(key)),
          requests: startIso ? requestsForRun(requestEntries, startIso, nextRunStartIso) : []
        }
      }),
    [eventRuns, controller.isRunning, cancelledRunKeys, requestEntries]
  )

  // Mirrors @tinytinkerer/pixel-agents's own conversationActivityStatus (issue
  // #454: "synchronize running/tool/awaiting/completed state with the active
  // Pixel Agents conversation") — the live run's badge below is literally the
  // same projection the office itself renders, not a second vocabulary.
  const liveStatus = conversationActivityStatus(
    useMemo<PixelAgentsConversation>(
      () => ({
        id: activeConversationId ?? '',
        title: '',
        events: controller.events,
        isRunning: controller.isRunning,
        eventsLoaded: true
      }),
      [activeConversationId, controller.events, controller.isRunning]
    )
  )

  const canSend =
    composer.prompt.trim().length > 0 && !controller.isRunning && !controller.isCoolingDown

  const handleStop = (): void => {
    const lastRun = traceRuns.at(-1)
    if (lastRun && lastRun.isLive) {
      setCancelledRunKeys((previous) => new Set(previous).add(lastRun.key))
    }
    controller.stop()
  }

  return (
    <div className="execution-trace-lab__panel">
      <form
        className="execution-trace-lab__composer"
        onSubmit={(event) => {
          event.preventDefault()
          composer.handleSubmit()
        }}
      >
        <label className="execution-trace-lab__composer-label" htmlFor={composerId}>
          Prompt the agent
        </label>
        <textarea
          id={composerId}
          className="execution-trace-lab__composer-input"
          rows={3}
          value={composer.prompt}
          onChange={(event) => composer.setPrompt(event.target.value)}
          disabled={controller.isRunning}
          placeholder="Ask the agent to do something that needs a tool…"
        />
        <p className="execution-trace-lab__composer-model">
          Next run uses model <code>{selectedModel}</code> with the <code>{agentType}</code>{' '}
          strategy — change either in Settings before sending.
        </p>
        <div className="execution-trace-lab__composer-actions">
          <button type="submit" disabled={!canSend}>
            {controller.submitLabel}
          </button>
          <button type="button" onClick={handleStop} disabled={!controller.isRunning}>
            Stop
          </button>
          <button
            type="button"
            onClick={() => void controller.rerunLastPrompt()}
            disabled={!controller.canRerun}
          >
            Retry last prompt
          </button>
          <button
            type="button"
            onClick={() => void controller.resetConversation()}
            disabled={controller.isRunning || controller.events.length === 0}
          >
            Clear trace
          </button>
          <ContextInspectorSlot />
        </div>
        <p className="execution-trace-lab__composer-hint">
          <strong>Send</strong> starts a new live request. <strong>Stop</strong> cancels the
          in-flight request without starting another. <strong>Retry last prompt</strong> re-sends
          your last prompt as a distinct run — the original run's trace below stays exactly as it
          was. <strong>Clear trace</strong> removes this conversation's events (no live request);
          use "Reset lab session" below to wipe the whole isolated docs session and start over.
        </p>
      </form>

      {controller.sendRefusalNotice ? (
        <p
          role="alert"
          className="execution-trace-lab__notice execution-trace-lab__notice--warning"
        >
          {controller.sendRefusalNotice}
        </p>
      ) : null}
      {controller.isCoolingDown ? (
        <p
          role="status"
          className="execution-trace-lab__notice execution-trace-lab__notice--warning"
        >
          Rate limited — retry available in {formatCooldown(controller.cooldownRemainingMs)}.
        </p>
      ) : null}

      {traceRuns.length === 0 ? (
        <p className="execution-trace-lab__empty">
          No runs yet — send a prompt above to start the first live request.
        </p>
      ) : (
        <ol className="execution-trace-lab__runs" aria-label="Agent run trace">
          {traceRuns.map((run) => {
            const turn = buildTurns(run.events)[0]
            return (
              <li key={run.key} className="execution-trace-lab__run">
                <div className="execution-trace-lab__run-header">
                  <span className="execution-trace-lab__run-title">{turn?.userText || 'Run'}</span>
                  {run.isLive ? (
                    <LiveStatusBadge status={liveStatus} />
                  ) : run.outcome ? (
                    <RunOutcomeBadge outcome={run.outcome} />
                  ) : null}
                </div>

                {run.requests.length > 0 ? (
                  <details className="execution-trace-lab__requests">
                    <summary>
                      Request preparation — {run.requests.length} request
                      {run.requests.length === 1 ? '' : 's'} sent to the model
                    </summary>
                    <ul>
                      {run.requests.map((entry, index) => (
                        <li key={`${run.key}-request-${index}`}>{requestSummary(entry)}</li>
                      ))}
                    </ul>
                    <p className="execution-trace-lab__requests-hint">
                      Open the request inspector above for the exact sanitized payload and response
                      of any captured request in this conversation.
                    </p>
                  </details>
                ) : null}

                {turn ? (
                  <>
                    <TurnActivityPanel
                      activity={turn.activity}
                      isLive={run.isLive}
                      serverNameById={controller.serverNameById}
                      resolveSummarizer={controller.resolveActivitySummarizer}
                    />
                    {turn.notice ? (
                      <p
                        role={turn.notice.kind === 'error' ? 'alert' : 'status'}
                        className={`execution-trace-lab__notice execution-trace-lab__notice--${turn.notice.level ?? 'info'}`}
                      >
                        {turn.notice.message}
                      </p>
                    ) : null}
                    {turn.assistantContent ? (
                      <div className="execution-trace-lab__synthesis">
                        <p className="execution-trace-lab__synthesis-label">Final synthesis</p>
                        <AssistantContent
                          content={turn.assistantContent}
                          isStreaming={turn.isStreaming}
                          turnId={turn.id}
                        />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
