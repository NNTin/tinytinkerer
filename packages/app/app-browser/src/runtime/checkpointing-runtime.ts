import {
  createEvent as event,
  type ChatRuntime,
  type ConversationMessage,
  type ToolInvocation
} from '@tinytinkerer/app-core'
import type { ChatEvent, ToolSource } from '@tinytinkerer/contracts'
import type { AppRunRecovery, AppToolResultRecord } from '../app-assistant-policy'
import {
  assessCheckpoint,
  describeStoppedRun,
  MAX_CHECKPOINT_CHARS,
  parseCheckpoint,
  RUN_CHECKPOINT_VERSION,
  turnRunFinished,
  UNCERTAIN_CALL,
  type RunCheckpoint,
  type RunCheckpointBlock,
  type RunCheckpointStore
} from './run-checkpoint'

// Checkpointing decorator around a chat runtime (issue #531).
//
// Write-ahead rule: a tool is dispatched only once the durable record can no
// longer misdescribe the run. The consumer pulls this generator lazily, so the
// inner runtime stays suspended at `agent.tool.started` — before the gate and
// before dispatch — until the commit below settles. If the call cannot be
// recorded as in flight (and the stale record cannot be removed either), the
// run stops there, without making the call. Results are committed as soon as
// they arrive, before the next decision.
//
// Lifecycle: a new run (Send/Regenerate) supersedes the conversation's saved
// progress; a run that reaches a final decision deletes it; any other end
// (failure, rate-limit stop, step budget, cancellation, reload) leaves it for
// an explicit Resume. Conversation delete/reset remove it with the events.

type CreateSession = (source?: string) => Promise<{
  replace(source: string): { source: string; content: unknown }
}>

export type CheckpointingOptions = {
  store: (() => Promise<RunCheckpointStore>) | undefined
  conversationId: string
  // Set only by an explicit Resume: the turn whose saved run continues.
  resume?: { turnId: string }
  account: () => Promise<string>
  origins: () => Promise<Record<string, string>>
  tools: ReadonlyMap<string, ToolSource | undefined>
  recovery?: AppRunRecovery
  createSession: CreateSession
  // The conversation's persisted events: durable evidence that a run already
  // finished, checked before a Resume and independent of the checkpoint.
  events?: () => Promise<readonly ChatEvent[]>
}

const successful = (invocations: readonly ToolInvocation[]): AppToolResultRecord[] =>
  invocations.flatMap((call) =>
    call.outcome.ok
      ? [
          {
            toolId: call.toolId,
            output: call.outcome.output,
            ...(call.source ? { source: call.source } : {})
          }
        ]
      : []
  )

export const withRunCheckpoint = (
  inner: ChatRuntime,
  options: CheckpointingOptions
): ChatRuntime => ({
  async *run(prompt, runOptions = {}) {
    const { conversationId, resume } = options
    const signal = runOptions.signal
    const store = await options.store?.().catch(() => undefined)
    // 'full' commits whole records; 'marker' has committed a not-resumable
    // marker (too large); 'off' removed the record after a failed write.
    // Only 'full' can be resumed, and only 'full' still has to commit.
    let mode: 'full' | 'marker' | 'off' = store ? 'full' : 'off'
    let checkpoint: RunCheckpoint | undefined
    let written = false
    // This attempt's fencing token, and the owner the stored record carries
    // as far as this run knows (undefined: nothing stored yet).
    const owner = crypto.randomUUID()
    let held: string | undefined
    // The record was claimed by another tab or window: this run must not make
    // another call, and writes nothing more.
    let lost = false
    const savedAs = () =>
      lost
        ? 'elsewhere'
        : mode === 'full'
          ? 'resumable'
          : mode === 'marker'
            ? 'too_large'
            : 'not_saved'

    const commit = async (): Promise<boolean> => {
      if (lost) return false
      if (mode !== 'full' || !checkpoint) return true
      checkpoint.owner = owner
      checkpoint.updatedAt = new Date().toISOString()
      const tooLarge = JSON.stringify(checkpoint).length > MAX_CHECKPOINT_CHARS
      let record = checkpoint
      if (tooLarge) {
        record = {
          ...checkpoint,
          invocations: [],
          state: 'blocked',
          blocked: {
            reason: "This run's results are too large to save for Resume.",
            retryable: false
          }
        }
        delete record.inFlight
      }
      try {
        if (await store!.swap(record, held)) {
          held = owner
          written = true
          if (tooLarge) mode = 'marker'
          return true
        }
        lost = true
        return false
      } catch {
        // Unwritable: remove our stale record so it cannot misdescribe the
        // run. Another owner's record is left alone, and so is this run.
        try {
          if (await store!.delete(conversationId, held ?? owner)) {
            mode = 'off'
            return true
          }
          lost = true
        } catch {
          // Neither write nor delete: the stale record stays authoritative.
        }
        return false
      }
    }

    // Persist why a Resume cannot proceed, then surface it on the latest turn.
    // Nothing is run: no model request, no tool call.
    async function* refuse(
      reason: string,
      block?: RunCheckpointBlock
    ): AsyncGenerator<ChatEvent, void> {
      // Recorded on the loaded record without claiming it.
      if (checkpoint && block && store) {
        checkpoint.state = 'blocked'
        checkpoint.blocked = block
        checkpoint.updatedAt = new Date().toISOString()
        await store.swap(checkpoint, checkpoint.owner).catch(() => false)
      }
      yield event('agent.run.started', { agentType: checkpoint?.agentType ?? 'react' })
      yield event('system', { message: `Resume stopped: ${reason}`, level: 'warning' })
    }

    let history: ConversationMessage[] | undefined = runOptions.history
    let restored: ToolInvocation[] | undefined
    if (resume) {
      const raw = store ? await store.get(conversationId).catch(() => null) : undefined
      if (raw === null) return yield* refuse('the saved progress could not be read. Try again.')
      const parsed = parseCheckpoint(raw)
      if (!parsed) return yield* refuse('there is no saved progress for this turn.')
      if (!parsed.ok) return yield* refuse(parsed.reason)
      checkpoint = parsed.checkpoint
      held = checkpoint.owner
      // Completion is read from the persisted events, so progress whose
      // cleanup failed is not continued: nothing is left unfinished.
      if (
        checkpoint.turnId === resume.turnId &&
        turnRunFinished((await options.events?.().catch(() => [])) ?? [], resume.turnId)
      ) {
        await store!.delete(conversationId, held).catch(() => false)
        checkpoint = undefined
        return yield* refuse('this run already finished, so there is nothing left to resume.')
      }
      const verdict = assessCheckpoint(checkpoint, {
        conversationId,
        turnId: resume.turnId,
        account: await options.account(),
        origins: await options.origins(),
        tools: options.tools,
        now: Date.now()
      })
      if (verdict) {
        // An earlier turn's record is not this turn's to mark.
        if (checkpoint.turnId !== resume.turnId) checkpoint = undefined
        return yield* refuse(verdict.reason, verdict)
      }

      const pending = checkpoint.inFlight
      if (pending) {
        let result: Awaited<ReturnType<NonNullable<AppRunRecovery['reconcile']>>> = {
          status: 'unknown'
        }
        try {
          if (options.recovery?.reconcile) {
            result = await options.recovery.reconcile({
              call: {
                toolId: pending.toolId,
                input: pending.input,
                ...(pending.source ? { source: pending.source } : {})
              },
              results: successful(checkpoint.invocations),
              ...(signal ? { signal } : {})
            })
          }
        } catch {
          return yield* refuse('the outcome of the last call could not be checked. Try again.', {
            reason: 'The outcome of the last call could not be checked.',
            retryable: true
          })
        }
        if (result.status === 'completed') {
          checkpoint.invocations.push({ ...pending, outcome: { ok: true, output: result.output } })
        } else if (result.status !== 'not_executed') {
          const reason = UNCERTAIN_CALL(pending.toolId)
          return yield* refuse(reason, { reason, retryable: false })
        }
        delete checkpoint.inFlight
      }

      if (options.recovery?.revalidate) {
        let verdict: Awaited<ReturnType<NonNullable<AppRunRecovery['revalidate']>>>
        try {
          verdict = await options.recovery.revalidate({
            results: successful(checkpoint.invocations),
            ...(signal ? { signal } : {})
          })
        } catch {
          return yield* refuse('the saved results could not be confirmed. Try again.', {
            reason: 'The saved results could not be confirmed.',
            retryable: true
          })
        }
        if (!verdict.ok) {
          return yield* refuse(verdict.reason, { reason: verdict.reason, retryable: false })
        }
      }

      checkpoint.state = 'running'
      checkpoint.attempts += 1
      delete checkpoint.blocked
      delete checkpoint.stop
      // Claim the attempt durably before any request (compare-and-swap on the
      // owner): of two tabs resuming the same progress only one gets here, and
      // a Resume that cannot record its own progress would make the next
      // reload misdescribe it.
      if (!(await commit()) || mode !== 'full') {
        const elsewhere = lost
        mode = 'off'
        lost = false
        checkpoint = undefined
        return yield* refuse(
          elsewhere
            ? 'this progress is already being resumed in another tab or window.'
            : 'progress could not be saved in this browser. Try again.'
        )
      }
      history = checkpoint.history
      restored = checkpoint.invocations.slice()
    } else if (store) {
      // A new run supersedes the conversation's saved progress. A failed
      // delete leaves a record scoped to an earlier turn, which Resume refuses.
      const prior = (await store.get(conversationId).catch(() => undefined)) as
        | { owner?: unknown }
        | undefined
      if (!(await store.delete(conversationId).catch(() => false))) {
        // Overwrite it on the first commit instead.
        held = typeof prior?.owner === 'string' ? prior.owner : undefined
      }
    }

    let finished = false
    let final = false
    let failure: string | undefined
    let stop: string | undefined
    try {
      const events = inner.run(checkpoint?.prompt ?? prompt, {
        ...(signal ? { signal } : {}),
        ...(history ? { history } : {}),
        ...(restored ? { restoredInvocations: restored } : {})
      })
      for await (let next of events) {
        switch (next.type) {
          case 'user.message':
            // A resumed run continues its turn rather than repeating the prompt.
            if (resume) continue
            checkpoint = {
              version: RUN_CHECKPOINT_VERSION,
              conversationId,
              turnId: next.id,
              prompt,
              history: history ?? [],
              agentType: 'plan-execute',
              account: await options.account(),
              origins: await options.origins(),
              invocations: [],
              state: 'running',
              attempts: 1,
              owner,
              createdAt: next.timestamp,
              updatedAt: next.timestamp
            }
            break
          case 'agent.run.started':
            if (checkpoint && !resume) {
              checkpoint.agentType = next.payload.agentType
              // Only ReAct runs can be resumed, so no other strategy's
              // progress is stored: nothing is ever offered that would be
              // refused. Its terminal answer still says what completed.
              if (checkpoint.agentType !== 'react') mode = 'off'
            }
            if (resume && checkpoint) {
              yield next
              const label = crypto.randomUUID()
              yield event('agent.step.started', {
                stepId: label,
                kind: 'observe',
                title: `Resumed with ${checkpoint.invocations.length} saved tool results`
              })
              next = event('agent.step.completed', { stepId: label })
            }
            break
          case 'agent.tool.started':
            if (checkpoint) {
              const { stepId, toolId, input, source } = next.payload
              checkpoint.inFlight = { callId: stepId, toolId, input, ...(source ? { source } : {}) }
              if (!(await commit())) {
                // Stop before the gate and dispatch: the call is never made.
                delete checkpoint.inFlight
                failure = lost
                  ? 'This run was resumed in another tab or window, so it stopped before its next tool call.'
                  : 'Progress could not be saved, so the next tool call was not made.'
                const saved = lost ? 'elsewhere' : 'not_saved'
                yield event('error', { message: failure })
                mode = 'off'
                const session = await options.createSession()
                yield event(
                  'assistant.done',
                  session.replace(describeStoppedRun(checkpoint, failure, saved)) as never
                )
                finished = true
                return
              }
            }
            break
          case 'agent.tool.completed':
          case 'agent.tool.failed':
            if (checkpoint?.inFlight?.callId === next.payload.stepId) {
              const { inFlight } = checkpoint
              delete checkpoint.inFlight
              checkpoint.invocations.push({
                ...inFlight,
                outcome:
                  next.type === 'agent.tool.completed'
                    ? { ok: true, output: next.payload.output }
                    : { ok: false, error: next.payload.error }
              })
              await commit()
            }
            break
          case 'agent.step.completed':
            if (next.payload.decisionKind === 'final') final = true
            break
          case 'rate.limit.cancelled':
            stop = 'rate_limited'
            break
          case 'error':
            failure = next.payload.message
            break
          case 'assistant.done':
            // The shared terminal-error path answers generically; with saved
            // work, say truthfully what finished and how to continue.
            if (failure !== undefined && checkpoint?.invocations.length) {
              const saved = savedAs()
              const session = await options.createSession()
              next = {
                ...next,
                payload: session.replace(
                  describeStoppedRun(checkpoint, `The next step failed: ${failure}`, saved)
                ) as typeof next.payload
              }
            }
            break
        }
        yield next
      }
      finished = true
    } finally {
      if (checkpoint && store) {
        if (finished && final && failure === undefined && stop === undefined) {
          // Completed: nothing left to resume.
          if (written && !lost) await store.delete(conversationId, owner).catch(() => false)
        } else if (written || checkpoint.invocations.length > 0 || checkpoint.inFlight) {
          checkpoint.state = 'stopped'
          checkpoint.stop = !finished
            ? 'cancelled'
            : (stop ?? (failure !== undefined ? 'failed' : 'unfinished'))
          await commit()
        }
      }
    }
  }
})
