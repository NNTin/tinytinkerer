import type { ConversationMessage, ToolInvocation } from '@tinytinkerer/app-core'
import type { AgentType, ChatEvent, ToolSource } from '@tinytinkerer/contracts'

// Saved progress of one run (issue #531): what an explicit Resume needs to
// continue that run's unfinished decision without repeating its tool calls.
//
// One record per conversation, keyed by conversation id, for that
// conversation's LATEST run. It is conversation state, never telemetry: the
// outputs it keeps can hold capability-bearing references (artifact ids,
// download URLs), so nothing here is ever reported or copied into public text.

/**
 * Bumped on any change a previous reader would misinterpret. A record with
 * another version is never read as this one: Resume reports it incompatible
 * and keeps it as evidence.
 */
export const RUN_CHECKPOINT_VERSION = 1

/** Serialized-size bound. Larger progress is never truncated to fit: it is
 * recorded as not resumable instead. */
export const MAX_CHECKPOINT_CHARS = 2_000_000

/** Saved progress older than this is refused rather than trusted. */
export const CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type CheckpointToolCall = {
  callId: string
  toolId: string
  input: Record<string, unknown>
  source?: ToolSource
}

export type RunCheckpointBlock = { reason: string; retryable: boolean }

export type RunCheckpoint = {
  version: typeof RUN_CHECKPOINT_VERSION
  conversationId: string
  // The run's turn: the id of its `user.message` event.
  turnId: string
  prompt: string
  // The conversation before this turn, exactly as the run first received it.
  history: ConversationMessage[]
  agentType: AgentType
  // Non-secret fingerprints of the access the run used: the signed-in
  // credential (or 'anonymous'), and each MCP server's address by server id.
  account: string
  origins: Record<string, string>
  // Every call with a recorded result, in run order: full output (never the
  // model-facing projection) and host-stamped source.
  invocations: ToolInvocation[]
  // A call recorded before dispatch with no result yet. On load it is
  // uncertain: it may have taken effect.
  inFlight?: CheckpointToolCall
  state: 'running' | 'stopped' | 'blocked'
  // Short, capability-free cause of the last stop.
  stop?: string
  blocked?: RunCheckpointBlock
  attempts: number
  // Fencing token of the run attempt that owns this record. Every write is a
  // compare-and-swap on it, so of two tabs resuming the same progress only one
  // can claim it, and a run whose record was claimed elsewhere stops before its
  // next tool call.
  owner: string
  createdAt: string
  updatedAt: string
}

/**
 * Saved-progress storage. Both writes are atomic compare-and-swaps on the
 * stored record's `owner` (one IndexedDB read-write transaction each, which
 * the browser serializes across tabs and connections).
 */
export interface RunCheckpointStore {
  get(conversationId: string): Promise<unknown>
  /** Writes `checkpoint` iff the stored record's owner is `expectedOwner`
   * (`undefined`: no record is stored). Returns whether it wrote. */
  swap(checkpoint: RunCheckpoint, expectedOwner: string | undefined): Promise<boolean>
  /** Deletes the record iff its owner is `expectedOwner`, or unconditionally
   * without one. Returns false only when a record owned by someone else is
   * left in place. */
  delete(conversationId: string, expectedOwner?: string): Promise<boolean>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCall = (value: unknown): value is CheckpointToolCall =>
  isRecord(value) &&
  typeof value.callId === 'string' &&
  typeof value.toolId === 'string' &&
  isRecord(value.input) &&
  (value.source === undefined || (isRecord(value.source) && typeof value.source.kind === 'string'))

const isInvocation = (value: unknown): value is ToolInvocation => {
  const outcome = (value as { outcome?: unknown } | null)?.outcome
  return isCall(value) && isRecord(outcome) && typeof outcome.ok === 'boolean'
}

const INCOMPATIBLE_CHECKPOINT =
  'This saved progress was written by a different version of the app and cannot be read safely.'

/** Structural check of a stored record. Anything unexpected is incompatible. */
export const parseCheckpoint = (
  value: unknown
): { ok: true; checkpoint: RunCheckpoint } | { ok: false; reason: string } | undefined => {
  if (value === undefined) return undefined
  const valid =
    isRecord(value) &&
    value.version === RUN_CHECKPOINT_VERSION &&
    typeof value.conversationId === 'string' &&
    typeof value.turnId === 'string' &&
    typeof value.prompt === 'string' &&
    Array.isArray(value.history) &&
    typeof value.agentType === 'string' &&
    typeof value.account === 'string' &&
    isRecord(value.origins) &&
    Array.isArray(value.invocations) &&
    value.invocations.every(isInvocation) &&
    (value.inFlight === undefined || isCall(value.inFlight)) &&
    typeof value.attempts === 'number' &&
    typeof value.owner === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  return valid
    ? { ok: true, checkpoint: value as RunCheckpoint }
    : { ok: false, reason: INCOMPATIBLE_CHECKPOINT }
}

export type CheckpointEnvironment = {
  conversationId: string
  turnId: string
  account: string
  origins: Record<string, string>
  // The tools registered for this run, with their host-stamped source.
  tools: ReadonlyMap<string, ToolSource | undefined>
  now: number
}

const blocked = (reason: string, retryable = false): RunCheckpointBlock => ({ reason, retryable })

const sameSource = (a: ToolSource, b: ToolSource | undefined): boolean =>
  a.kind === b?.kind && a.groupId === b.groupId

/**
 * Whether the saved progress may continue in this session. `undefined` means
 * yes; otherwise the truthful reason it may not, and whether retrying after
 * the reader fixes something (signing in, re-enabling a server) could help.
 * The uncertain in-flight call is judged separately, by reconciliation.
 */
export const assessCheckpoint = (
  checkpoint: RunCheckpoint,
  env: CheckpointEnvironment
): RunCheckpointBlock | undefined => {
  if (checkpoint.conversationId !== env.conversationId || checkpoint.turnId !== env.turnId) {
    return blocked(
      'This saved progress belongs to an earlier turn, so it cannot continue this one.'
    )
  }
  if (checkpoint.blocked && !checkpoint.blocked.retryable) return checkpoint.blocked
  if (checkpoint.agentType !== 'react') {
    return blocked(
      `Resume continues ReAct runs only; this run used the ${checkpoint.agentType} agent. Its activity is kept, but nothing is repeated automatically.`
    )
  }
  // From creation, which no later write (attempt, refusal, stop) moves.
  if (!(env.now - Date.parse(checkpoint.createdAt) <= CHECKPOINT_TTL_MS)) {
    return blocked('This saved progress has expired. Start a new request instead.')
  }
  if (checkpoint.account !== env.account) {
    return blocked(
      // The app keeps no stable account identity client-side, only the
      // credential: a fresh sign-in issues a new token, even for the same
      // account, so only the original credential can match.
      'This progress was saved under a different sign-in. Only the credential it was saved with can be confirmed to have the same access; a new sign-in, even to the same account, cannot. Resume works again if that credential is restored (for example by the hosting page); otherwise start a new request.',
      true
    )
  }
  for (const call of [
    ...checkpoint.invocations,
    ...(checkpoint.inFlight ? [checkpoint.inFlight] : [])
  ]) {
    if (!call.source) {
      return blocked(
        `A saved result of ${call.toolId} has no recorded origin, so it cannot be trusted on resume.`
      )
    }
    if (!env.tools.has(call.toolId)) {
      return blocked(
        `${call.toolId} is not available now (its server or tool may be disabled, down or removed). Make it available again, then resume.`,
        true
      )
    }
    const groupId = call.source.groupId ?? ''
    if (
      !sameSource(call.source, env.tools.get(call.toolId)) ||
      (call.source.kind === 'mcp' && checkpoint.origins[groupId] !== env.origins[groupId])
    ) {
      return blocked(
        `${call.toolId} now comes from a different source or server address than when this progress was saved, so its saved results cannot be trusted on resume.`,
        true
      )
    }
  }
}

/**
 * Whether the persisted events show the turn's latest run finished: a final
 * decision followed by its answer, with no failure or rate-limit stop. This is
 * durable terminal evidence independent of the checkpoint itself, so progress
 * whose cleanup failed is never offered again. A refused Resume (no step or
 * tool activity) does not count as a new run.
 */
export const turnRunFinished = (events: readonly ChatEvent[], turnId: string): boolean => {
  const start = events.findIndex((event) => event.id === turnId)
  if (start < 0) return false
  let final = false
  let finished = false
  let newRun = false
  for (const event of events.slice(start + 1)) {
    if (event.type === 'user.message') break
    if (event.type === 'agent.run.started') newRun = true
    else if (event.type.startsWith('agent.step.') || event.type.startsWith('agent.tool.')) {
      if (newRun) final = finished = newRun = false
      if (event.type === 'agent.step.completed' && event.payload.decisionKind === 'final') {
        final = true
      }
    } else if (event.type === 'error' || event.type === 'rate.limit.cancelled') final = false
    else if (event.type === 'assistant.done') finished = final
  }
  return finished
}

export const UNCERTAIN_CALL = (toolId: string): string =>
  `The last call (${toolId}) was sent, but its result never arrived and nothing could confirm whether it took effect. Repeating it could duplicate its effect, so recovery stopped here. Check the target system, then describe its current state in a new message.`

/** Reader-facing account of what a stopped run did and did not do. Names tools
 * only: outputs (which may carry capability references) never appear. */
export const describeStoppedRun = (
  checkpoint: Pick<RunCheckpoint, 'invocations' | 'agentType'>,
  cause: string,
  saved: 'resumable' | 'too_large' | 'not_saved' | 'elsewhere'
): string => {
  const lines = checkpoint.invocations.map(
    (call) => `- \`${call.toolId}\` — ${call.outcome.ok ? 'returned a result' : 'failed'}`
  )
  const next =
    checkpoint.agentType !== 'react'
      ? `Resume is not available for the ${checkpoint.agentType} agent; the activity above is kept.`
      : saved === 'too_large'
        ? "This run's results are too large to save for Resume, so continuing means starting a new request."
        : saved === 'not_saved'
          ? 'Its progress could not be saved in this browser, so this run cannot be resumed.'
          : saved === 'elsewhere'
            ? 'Its saved progress now belongs to the run continuing in another tab or window.'
            : 'Your progress is saved in this conversation. Choose **Resume** to continue from the unfinished step; the calls above are not repeated.'
  return [
    `**This run stopped before it finished.** ${cause}`,
    `Completed before it stopped:\n${lines.join('\n')}`,
    'Not done: the step that failed and everything after it. A call that returned a result is not proof that its output was checked, rendered or exported.',
    next
  ].join('\n\n')
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')

/** Non-secret, stable fingerprint (SHA-256 prefix) of a credential or address. */
export const fingerprint = async (value: string): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).slice(0, 32)
