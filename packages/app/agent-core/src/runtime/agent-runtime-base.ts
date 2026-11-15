import {
  partitionToolResultMedia,
  type ChatEvent,
  type ReActDecision
} from '@tinytinkerer/contracts'
import { isRateLimitError, type RateLimitError } from '../errors/rate-limit-error'
import { createEvent } from '../events/create-event'
import type {
  AssistantContentFinalizer,
  AssistantContentSession,
  ConversationMessage,
  CreateAssistantContentSession,
  ExecutionContext,
  ModelProvider,
  ProviderCallOptions
} from '../types'
import { RuntimeTimeoutError, type DecisionTimeoutDiagnostics } from '../errors/timeout-error'
import { runToolBeforeExecuteHooks } from '../plugins/hooks'
import type { AgentHookContribution } from '../plugins/types'
import { ToolRegistry } from '../tools/registry'
import { MAX_AUTO_RETRY_AFTER_MS, withTimeout } from './utils'

// Reports a terminal runtime failure to the host's telemetry sink (e.g. Sentry
// in the browser). Injected like `createAssistantContentSession` so agent-core
// stays a leaf with no telemetry dependency; a host that registers nothing
// simply drops the report. Only terminal failures reach here — an aborted run
// and the dedicated rate-limit cooldown/retry paths are handled upstream and
// never reported.
export type RuntimeErrorReporter = (error: Error) => void

// The per-turn step bound (issue #510, T4): how many decisions a turn may take
// before the runtime stops and synthesizes from what it has. In the ReAct loop
// every decision counts, the closing "final" one included: a turn makes at most
// 16 tool calls, or 15 when the model ends it with its own closing decision. An
// iterative MCP workflow (create a project, place parts, wire, check, fix, check
// again, plan, export) needs ten or more, which the old default of 5 cut off
// half way. Plan-execute caps its plan at this many steps and Hybrid caps its
// total sub-loop iterations at it.
export const DEFAULT_MAX_ITERATIONS = 16

// A bound below one would let a turn take no decision at all, not even the one
// that answers, so it is raised to 1. A fractional bound is floored. A
// non-finite one (NaN, Infinity) falls back to the default rather than meaning
// "unbounded".
const normalizeMaxIterations = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value)
    ? DEFAULT_MAX_ITERATIONS
    : Math.max(1, Math.floor(value))

const bound = (value: number | undefined, fallback: number): number =>
  value! >= 0 && Number.isFinite(value) ? value! : fallback

export type AgentRuntimeOptions = {
  /**
   * Per-turn step bound. Defaults to {@link DEFAULT_MAX_ITERATIONS}; values below
   * 1 are raised to 1, and a non-finite value falls back to the default.
   */
  maxIterations?: number
  maxToolCallsPerStep?: number
  toolTimeoutMs?: number
  stepTimeoutMs?: number
  /** First meaningful streamed response (default >=90s), or entire single-shot
   * decision/planner call. Subsequent meaningful progress uses stepTimeoutMs
   * (default 15s). Neither SSE heartbeats nor metadata reset these budgets. */
  firstChunkTimeoutMs?: number
  /** Absolute streamed-decision response/argument-assembly ceiling, from request
   * dispatch, independent of progress (default 300s). Must be positive and finite.
   * Explicit request-start providers exclude pre-request waits from this budget. */
  decisionResponseTimeoutMs?: number
  /** Longest single rate-limit/quota cooldown waited out before a retry (default
   * 300s). Cooldown time precedes dispatch and is excluded from response budgets. */
  maxCooldownMs?: number
  /** Total cooldown waiting allowed per run, across every retry (default 600s).
   * Negative or nonfinite values for either bound fall back to the default. */
  maxRunCooldownMs?: number
  createAssistantContentSession?: CreateAssistantContentSession
  /**
   * Host-owned rewrite of the composed answer, applied once before
   * `assistant.done` (issue #478). Absent for every host that does not need it,
   * which is all of them except the documentation assistant.
   */
  finalizeAssistantContent?: AssistantContentFinalizer
  reportError?: RuntimeErrorReporter
  hooks?: readonly AgentHookContribution[]
  hookTimeoutMs?: number
  /**
   * Budget for anything that blocks on a human (issue #85). It governs BOTH
   * `tool.beforeExecute` gates flagged `awaitsHumanInput` (e.g. the Permissions
   * plugin's allow/deny prompt) AND tools flagged `awaitsHumanInput` whose own
   * `execute` blocks on a person (e.g. the choice-prompt tool awaiting a
   * selection). A person needs far longer than a machine hook to read and answer,
   * so the generic `hookTimeoutMs` (60s) / `toolTimeoutMs` (10s) are too short and
   * surface a confusing internal timeout. This larger budget governs the human
   * wait; it stays bounded so it still backstops a host that never renders the
   * prompt. Named for what it is (a human-input budget), not for the hook it
   * originally served.
   */
  humanInputTimeoutMs?: number
}

export type RunOptions = {
  signal?: AbortSignal
  history?: ConversationMessage[]
}

// Outcome of running a single tool, surfaced to callers via the generator's
// return value so they can record observations/notes without re-inspecting the
// emitted events.
export type ToolOutcome = { ok: true; output: unknown } | { ok: false; error: string }

export type ReActLoopExitReason = 'final' | 'budget_exhausted' | 'decision_stopped' | 'aborted'

// Result of a ReAct loop. `reachedFinal` is the concrete "the agent decided it
// was done" signal; the Hybrid runtime treats a loop that exhausts its budget
// without reaching final as a stuck step worth replanning. `exitReason`
// distinguishes "finished normally" from "stopped early", which matters for
// Hybrid when deciding whether to replan, stop the run, or count a step.
export type ReActLoopResult = {
  iterations: number
  reachedFinal: boolean
  note: string
  exitReason: ReActLoopExitReason
}

// Why a cooldown was not waited out: a single wait above maxCooldownMs, the
// run's cumulative maxRunCooldownMs, or cancellation.
type CooldownStopReason = 'too_long' | 'run_limit' | 'cancelled'

type DecisionLoopControl =
  | { kind: 'decision'; decision: ReActDecision }
  | { kind: 'stop'; reason: CooldownStopReason }

// Upper bound on a tool-result note. Tool output is arbitrary and can be large
// (a full web-search result set, a code-exec payload, an MCP response). The note
// is pushed into `context.notes`, which is fed back into every subsequent model
// call, so serializing output verbatim bloats the upstream prompt (cost,
// latency, possible context overflow) and grows browser memory per turn. The
// full output still lives in `context.toolResults`; the note only needs to be a
// hint. A few KB keeps short outputs intact while capping pathological ones.
const MAX_NOTE_CHARS = 2_000

// Serializes a tool output into a short note, bounding its length. Non-
// serializable values fall back to String(); the result is truncated with an
// explicit marker so a downstream reader can tell it was clipped.
const serializeToolNote = (toolId: string, output: unknown): string => {
  let serialized: string
  try {
    // Strip any image media's base64 `dataUrl` before it can fill the note (and
    // thus every subsequent model call's context) with garbage. A note has no
    // ref-resolution consumer — unlike the tool message built in
    // `toolInvocationsToMessages`, nothing here ever turns a `mediaRef` back
    // into an image — so there is no need to mint one; keeping each item's
    // `description` is enough for the model to know an image was produced
    // without paying for the pixels.
    const { rest, media } = partitionToolResultMedia(output)
    const noted =
      media.length > 0
        ? { ...(rest as Record<string, unknown>), media: media.map((item) => item.description) }
        : output
    serialized = JSON.stringify(noted) ?? String(noted)
  } catch {
    serialized = String(output)
  }
  if (serialized.length > MAX_NOTE_CHARS) {
    serialized = `${serialized.slice(0, MAX_NOTE_CHARS)}… [truncated]`
  }
  return `${toolId}: ${serialized}`
}

export const createStepId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `step-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// Shared machinery for every agent strategy: tool execution, the ReAct
// think/act/observe loop, and the rate-limit-aware synthesis stream. Each
// concrete strategy implements its own `run()` that orchestrates these helpers
// and emits the strategy-agnostic agent-trace events.
export abstract class AgentRuntimeBase {
  protected readonly maxIterations: number
  protected readonly maxToolCallsPerStep: number
  protected readonly toolTimeoutMs: number
  protected readonly stepTimeoutMs: number
  protected readonly firstChunkTimeoutMs: number
  protected readonly responseTimeoutMs: number
  protected readonly maxCooldownMs: number
  protected readonly maxRunCooldownMs: number
  // Cooldown already waited per run, keyed by the run's context.
  private readonly cooldownWaited = new WeakMap<ExecutionContext, number>()
  protected readonly createAssistantContentSession: CreateAssistantContentSession
  protected readonly finalizeAssistantContent: AssistantContentFinalizer | undefined
  protected readonly reportError: RuntimeErrorReporter
  protected readonly hooks: readonly AgentHookContribution[]
  protected readonly hookTimeoutMs: number
  protected readonly humanInputTimeoutMs: number

  constructor(
    protected readonly provider: ModelProvider,
    protected readonly registry: ToolRegistry,
    options: AgentRuntimeOptions = {}
  ) {
    this.maxIterations = normalizeMaxIterations(options.maxIterations)
    this.maxToolCallsPerStep = options.maxToolCallsPerStep ?? 1
    this.toolTimeoutMs = options.toolTimeoutMs ?? 10_000
    this.stepTimeoutMs = options.stepTimeoutMs ?? 15_000
    // Allow a generous whole-response wait (>= the idle gap) so slow reasoning
    // models are not cut off before they finish a single-shot call — first
    // streamed token, full non-streaming decision, or the planner (FRONTEND-S).
    // 90s gives gpt-5-class models room to first token while staying under the
    // edge's 120s upstream backstop, so the frontend stays the authority.
    this.firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? Math.max(this.stepTimeoutMs, 90_000)
    const responseTimeoutMs = options.decisionResponseTimeoutMs ?? 300_000
    this.responseTimeoutMs =
      Number.isFinite(responseTimeoutMs) && responseTimeoutMs > 0 ? responseTimeoutMs : 300_000
    this.maxCooldownMs = bound(options.maxCooldownMs, MAX_AUTO_RETRY_AFTER_MS)
    this.maxRunCooldownMs = bound(options.maxRunCooldownMs, 600_000)
    this.createAssistantContentSession =
      options.createAssistantContentSession ?? createPlainTextAssistantContentSession
    this.finalizeAssistantContent = options.finalizeAssistantContent
    this.reportError = options.reportError ?? (() => {})
    this.hooks = options.hooks ?? []
    this.hookTimeoutMs = options.hookTimeoutMs ?? 60_000
    // 5 minutes: generous enough for a human to read a tool (e.g. run_javascript
    // source) and decide, or to answer a choice poll, while still bounding the wait
    // so a host that never renders the prompt fails closed rather than hanging the
    // run forever.
    this.humanInputTimeoutMs = options.humanInputTimeoutMs ?? 300_000
  }

  abstract run(prompt: string, options?: RunOptions): AsyncGenerator<ChatEvent>

  protected createContext(prompt: string, history: ConversationMessage[]): ExecutionContext {
    return {
      prompt,
      history,
      plan: { complexity: 'low', steps: [] },
      notes: [],
      toolResults: {},
      toolInvocations: []
    }
  }

  // Terminal error handling shared by every strategy: an aborted run ends
  // cleanly with an empty answer; any other failure is reported to the host's
  // telemetry sink, then surfaces an error event and a friendly fallback answer.
  protected async *handleRunError(error: unknown): AsyncGenerator<ChatEvent> {
    if (error instanceof Error && error.name === 'AbortError') {
      // An aborted run is the user cancelling — never an issue worth reporting.
      yield createEvent('assistant.done', (await this.createAssistantContentSession()).snapshot())
      return
    }
    // Any non-abort failure that reaches the terminal handler is reported. The
    // dedicated cooldown/retry path consumes handled rate limits before they get
    // here, so a RateLimitError arriving at this point is an *unhandled* rate
    // limit and is reported like any other failure. Guarded so a misbehaving
    // sink can never break the run.
    const normalized = error instanceof Error ? error : new Error('Unknown runtime error')
    try {
      this.reportError(normalized)
    } catch {
      // Telemetry must never break the run.
    }
    const message = normalized.message
    yield createEvent('error', { message })
    yield createEvent(
      'assistant.done',
      (await this.createAssistantContentSession()).replace(
        'I hit an execution issue. Please try again.'
      )
    )
  }

  // Runs one tool, emitting agent.tool.* events keyed by `stepId`, and returns
  // the outcome so the caller can record the observation.
  protected async *executeToolStep(
    stepId: string,
    parentStepId: string | undefined,
    toolCall: { toolId: string; input: Record<string, unknown> }
  ): AsyncGenerator<ChatEvent, ToolOutcome> {
    const { toolId, input } = toolCall
    // Read from the REGISTERED tool, never from the model's chosen id: this is
    // the attribution a consumer gates trust on (issue #478), so it has to come
    // from what the host registered under that id. An unknown id has none, which
    // is the fail-closed direction.
    const source = this.registry.get(toolId)?.source

    // Always emit a started→failed pair (even when policy disables tool calls),
    // so the projection layer — which coalesces tool events by matching a failure
    // to the most recent started tool with the same stepId — can nest the failure
    // under its parent step and keep the input/parent linkage.
    yield createEvent('agent.tool.started', {
      stepId,
      ...(parentStepId ? { parentStepId } : {}),
      toolId,
      input,
      ...(source ? { source } : {})
    })

    if (this.maxToolCallsPerStep < 1) {
      const error = 'Tool calls disabled by runtime policy'
      yield createEvent('agent.tool.failed', { stepId, toolId, error, kind: 'blocked' })
      return { ok: false, error }
    }

    // A tool whose own execution blocks on a human (issue #85, e.g. the
    // choice-prompt tool) is handled differently in exactly ONE way the runtime
    // owns: its execution gets the human-input budget rather than the short machine
    // timeout (D1, see the withTimeout below). The runtime does NOT skip the gate —
    // it surfaces the flag on the ToolExecutionContext and lets each gate decide.
    // The permissions gate self-exempts a human-input tool (gating a tool that
    // already asks the user would be a prompt-to-show-a-prompt), but a future
    // non-permission gate still runs. So the gate chain always runs here.
    const awaitsHumanInput = this.registry.get(toolId)?.awaitsHumanInput === true

    const gate = await runToolBeforeExecuteHooks(
      this.hooks,
      {
        stepId,
        ...(parentStepId ? { parentStepId } : {}),
        toolId,
        input,
        ...(awaitsHumanInput ? { awaitsHumanInput: true } : {})
      },
      this.hookTimeoutMs,
      this.humanInputTimeoutMs
    )
    if (!gate.allow) {
      const error = `Tool execution blocked: ${gate.reason}`
      yield createEvent('agent.tool.failed', { stepId, toolId, error, kind: 'blocked' })
      return { ok: false, error }
    }

    try {
      const output = await withTimeout(
        this.registry.run(toolId, input),
        awaitsHumanInput ? this.humanInputTimeoutMs : this.toolTimeoutMs,
        `Tool ${toolId} timed out`
      )
      yield createEvent('agent.tool.completed', {
        stepId,
        toolId,
        output,
        ...(source ? { source } : {})
      })
      return { ok: true, output }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed'
      const kind = error instanceof RuntimeTimeoutError ? 'timeout' : 'execution'
      yield createEvent('agent.tool.failed', { stepId, toolId, error: message, kind })
      return { ok: false, error: message }
    }
  }

  // Emits a single "think" step and returns the decision, transparently waiting
  // out a short rate limit and retrying the decision. A rate limit too long to
  // auto-retry (or a cancelled wait) finishes the loop so the run can wind down
  // gracefully rather than ending with the generic execution-error fallback.
  protected async *nextDecision(
    context: ExecutionContext,
    callOptions: ProviderCallOptions,
    parentStepId: string | undefined
  ): AsyncGenerator<ChatEvent, DecisionLoopControl> {
    while (true) {
      try {
        return {
          kind: 'decision',
          decision: yield* this.attemptDecision(context, callOptions, parentStepId)
        }
      } catch (error) {
        if (!isRateLimitError(error)) {
          throw error
        }
        const outcome = yield* this.awaitRateLimitRetry(error, callOptions.signal, context)
        if (outcome.retry) {
          continue
        }
        // Cooldown beyond a bound or wait cancelled: stop deciding and let the run wind
        // down. This is not a real `final` decision, so the caller can stop the
        // sub-loop without counting the current step as successfully completed.
        return { kind: 'stop', reason: outcome.reason }
      }
    }
  }

  // Asks the provider for the next decision once, emitting the "think" step.
  // Prefers the streaming path (streamDecision) so the thought renders live via
  // agent.step.delta; the final thought is carried on the completed step's
  // summary so it survives a reload. Falls back to the non-streaming
  // decideNextAction otherwise. Errors (including rate limits) propagate to
  // nextDecision, which owns the retry policy.
  private async *attemptDecision(
    context: ExecutionContext,
    callOptions: ProviderCallOptions,
    parentStepId: string | undefined
  ): AsyncGenerator<ChatEvent, ReActDecision> {
    const { provider } = this
    const thoughtStepId = createStepId()
    const parentField = parentStepId ? { parentStepId } : {}

    if (provider.streamDecision) {
      yield createEvent('agent.step.started', {
        stepId: thoughtStepId,
        ...parentField,
        kind: 'think',
        title: 'Thinking…'
      })

      // Response timing begins at dispatch for lifecycle-aware providers. The
      // explicit start is extensible to pre-request quota waiting (#533); legacy
      // providers retain timing from invocation. Progress is internal, never a
      // visible thought, and cannot extend the absolute response ceiling.
      const controller = new AbortController()
      const userSignal = callOptions.signal
      const onUserAbort = () => controller.abort()
      if (userSignal) {
        if (userSignal.aborted) {
          controller.abort()
        } else {
          userSignal.addEventListener('abort', onUserAbort, { once: true })
        }
      }

      let timeout: DecisionTimeoutDiagnostics | undefined
      let startedAt: number | undefined
      let model: string | undefined
      let assemblingArguments = false
      let lastPhase: DecisionTimeoutDiagnostics['lastPhase'] = 'request_started'
      let timer: ReturnType<typeof setTimeout> | undefined
      const responseBudget = this.responseTimeoutMs
      // One timer schedules the earlier deadline. A monotonic clock keeps the
      // absolute response ceiling fixed even when wall time changes.
      const arm = () => {
        clearTimeout(timer)
        const remaining = responseBudget - (performance.now() - startedAt!)
        const firstResponse = lastPhase === 'request_started'
        const idleBudget = firstResponse ? this.firstChunkTimeoutMs : this.stepTimeoutMs
        const ceiling = lastPhase === 'decision' || remaining <= idleBudget
        timer = setTimeout(
          () => {
            if (controller.signal.aborted) return
            timeout = {
              cause: ceiling
                ? 'response_ceiling'
                : firstResponse
                  ? 'first_response'
                  : assemblingArguments
                    ? 'argument_assembly'
                    : 'idle',
              lastPhase,
              elapsedMs: performance.now() - startedAt!,
              budgetMs: ceiling ? responseBudget : idleBudget,
              ...(model ? { model } : {})
            }
            controller.abort()
          },
          ceiling ? remaining : idleBudget
        )
      }
      const start = () => {
        if (startedAt !== undefined) return
        startedAt = performance.now()
        arm()
      }

      let thought = ''
      let decision: ReActDecision | undefined
      try {
        if (provider.decisionStreamLifecycle !== 'explicit-request-start') start()
        for await (const chunk of provider.streamDecision(context, {
          ...callOptions,
          signal: controller.signal
        })) {
          if (controller.signal.aborted) break
          switch (chunk.kind) {
            case 'request-start':
              model ??= chunk.model
              start()
              continue
            case 'progress':
              lastPhase = chunk.source
              if (chunk.source === 'tool_call') assemblingArguments = true
              break
            case 'thought':
              if (!chunk.text || chunk.text === thought) continue
              // Legacy providers have no source-tagged progress.
              if (lastPhase === 'request_started') lastPhase = 'content'
              thought = chunk.text
              break
            case 'decision':
              start()
              decision = chunk.decision
              lastPhase = 'decision'
              arm()
              continue
          }
          start()
          arm()
          if (chunk.kind === 'thought') {
            yield createEvent('agent.step.delta', { stepId: thoughtStepId, text: thought })
          }
        }
        controller.signal.throwIfAborted()
        if (!decision) throw new Error('ReAct decision stream ended without a decision')
      } catch (error) {
        // The provider can throw or end on abort. Both paths produce the same
        // typed timeout; other failures (including user abort/429) pass through.
        const failure = timeout
          ? new RuntimeTimeoutError('ReAct decision timed out', timeout)
          : error
        yield createEvent('agent.step.failed', {
          stepId: thoughtStepId,
          error: failure instanceof Error ? failure.message : 'ReAct decision failed'
        })
        throw failure
      } finally {
        clearTimeout(timer)
        if (userSignal && !userSignal.aborted) {
          userSignal.removeEventListener('abort', onUserAbort)
        }
      }

      // The decision resolves at end-of-stream, so carry its kind on the completed
      // event: the timeline surfaces it the moment the decision lands (its "live"
      // entry) and it persists on reload. The model's prose IS the streamed thought
      // (the step label), so emit it as the summary — always, even empty, so a
      // silent tool-call turn clears the live "Thinking…" placeholder and the step
      // renders as just the decision badge (issue #276).
      const resolved = decision
      yield createEvent('agent.step.completed', {
        stepId: thoughtStepId,
        summary: thought,
        decisionKind: resolved.kind
      })

      return resolved
    }

    // Non-streaming decisions wait for the whole model response in one shot, so
    // they get the same generous reasoning-model budget as a streaming first
    // chunk rather than the short inter-chunk idle gap (FRONTEND-S).
    const decision = await withTimeout(
      provider.decideNextAction!(context, callOptions),
      this.firstChunkTimeoutMs,
      'ReAct decision timed out'
    )
    // The non-streaming path knows the whole decision up front (no live stream to
    // grow), so the model's prose IS the step's thought: carry it as the title (the
    // step label). When the model is silent the title is empty, so the step renders
    // as just the decision badge — matching the streaming path (issue #276).
    const thoughtTitle = decision.reasoning ?? ''
    yield createEvent('agent.step.started', {
      stepId: thoughtStepId,
      ...parentField,
      kind: 'think',
      title: thoughtTitle,
      decisionKind: decision.kind
    })
    yield createEvent('agent.step.completed', {
      stepId: thoughtStepId,
      decisionKind: decision.kind
    })
    return decision
  }

  // The shared Think -> Act -> Observe loop used by ReAct and (per plan step) by
  // Hybrid. Each iteration asks the provider for the next action, executes it,
  // and records the observation back into `context` so the next decision sees
  // it. Stops when the provider decides it is `final` or the budget runs out.
  protected async *runReActLoop(
    context: ExecutionContext,
    options: {
      budget: number
      signal?: AbortSignal
      parentStepId?: string
    }
  ): AsyncGenerator<ChatEvent, ReActLoopResult> {
    const { provider } = this
    if (!provider.decideNextAction && !provider.streamDecision) {
      throw new Error(
        'The configured provider implements neither streamDecision nor decideNextAction, which the ReAct and Hybrid agents require.'
      )
    }

    const callOptions = {
      ...(options.signal ? { signal: options.signal } : {})
    }

    let iterations = 0
    let note = ''

    while (iterations < options.budget) {
      if (options.signal?.aborted) {
        return { iterations, reachedFinal: false, note, exitReason: 'aborted' }
      }

      const control = yield* this.nextDecision(context, callOptions, options.parentStepId)
      if (control.kind === 'stop') {
        return {
          iterations,
          reachedFinal: false,
          note,
          exitReason:
            control.reason === 'cancelled' && options.signal?.aborted
              ? 'aborted'
              : 'decision_stopped'
        }
      }

      const { decision } = control
      iterations += 1

      if (decision.kind === 'final') {
        return { iterations, reachedFinal: true, note, exitReason: 'final' }
      }

      const actStepId = createStepId()
      yield createEvent('agent.step.started', {
        stepId: actStepId,
        ...(options.parentStepId ? { parentStepId: options.parentStepId } : {}),
        kind: 'act',
        title: `Using ${decision.toolId}`
      })

      // The tool run is a child of the act step: it gets its own stepId and is
      // parented under the act step, mirroring Plan-then-Execute. (An 'act' step
      // "wraps a tool call" per the agent-trace contract — the tool is a nested
      // node, not the act step itself.)
      const toolStepId = createStepId()
      const outcome = yield* this.executeToolStep(toolStepId, actStepId, {
        toolId: decision.toolId,
        input: decision.input
      })

      // Record the call in run order as the structured source for native
      // tool-call message assembly (issue #276). `toolStepId` is the tool_call
      // id echoed on both the assistant tool_call and its tool result message.
      const toolSource = this.registry.get(decision.toolId)?.source
      context.toolInvocations.push({
        callId: toolStepId,
        toolId: decision.toolId,
        input: decision.input,
        outcome,
        ...(toolSource ? { source: toolSource } : {})
      })

      if (outcome.ok) {
        note = serializeToolNote(decision.toolId, outcome.output)
        const existing = context.toolResults[decision.toolId]
        const nextResults = Array.isArray(existing)
          ? [...(existing as unknown[]), outcome.output]
          : existing === undefined
            ? [outcome.output]
            : [existing, outcome.output]
        context.toolResults[decision.toolId] = nextResults
        context.notes.push(note)
        yield createEvent('agent.step.completed', { stepId: actStepId, summary: note })
      } else {
        // A tool failure is an observation the model can react to on the next
        // iteration; record it and keep looping until final or budget.
        context.notes.push(outcome.error)
        yield createEvent('agent.step.failed', { stepId: actStepId, error: outcome.error })
      }
    }

    return { iterations, reachedFinal: false, note, exitReason: 'budget_exhausted' }
  }

  // Emits the rate-limit lifecycle events for a RateLimitError and, when the
  // cooldown fits both its own and the run's cumulative bound, waits it out.
  // Returns whether the caller should retry; on giving up it reports why (a
  // bound was exceeded or the wait was cancelled) so the caller can choose its
  // own terminal handling. Shared by synthesis and ReAct decisions, including
  // provider quota waits raised before dispatch (#533), so every rate-limited
  // call funnels through the same cooldown/retry behaviour, outside every
  // response timer.
  protected async *awaitRateLimitRetry(
    error: RateLimitError,
    signal: AbortSignal | undefined,
    context: ExecutionContext
  ): AsyncGenerator<ChatEvent, { retry: true } | { retry: false; reason: CooldownStopReason }> {
    const waited = (this.cooldownWaited.get(context) ?? 0) + error.retryAfterMs
    const exceeded =
      error.retryAfterMs > this.maxCooldownMs
        ? 'too_long'
        : waited > this.maxRunCooldownMs
          ? 'run_limit'
          : undefined

    if (exceeded) {
      yield createEvent('rate.limit.cancelled', {
        retryAfterMs: error.retryAfterMs,
        retryAt: error.retryAt,
        message: error.message,
        reason: exceeded
      })
      return { retry: false, reason: exceeded }
    }
    this.cooldownWaited.set(context, waited)

    yield createEvent('rate.limit.waiting', {
      retryAfterMs: error.retryAfterMs,
      retryAt: error.retryAt,
      message: error.message,
      autoRetry: true
    })

    const elapsed = await this.waitUntil(error.retryAt, signal)
    if (!elapsed) {
      yield createEvent('rate.limit.cancelled', {
        retryAfterMs: error.retryAfterMs,
        retryAt: error.retryAt,
        message: 'Retry cancelled',
        reason: 'cancelled'
      })
      return { retry: false, reason: 'cancelled' }
    }

    yield createEvent('rate.limit.recovered', { retryAt: error.retryAt })
    return { retry: true }
  }

  // Streams the final answer, transparently waiting out short rate limits and
  // retrying. Identical behaviour for every strategy. Brackets the stream with a
  // `synthesize` step so the activity timeline shows the compose phase.
  protected async *synthesizeWithRateLimit(
    context: ExecutionContext,
    signal: AbortSignal | undefined
  ): AsyncGenerator<ChatEvent> {
    const synthesizeStepId = createStepId()
    yield createEvent('agent.step.started', {
      stepId: synthesizeStepId,
      kind: 'synthesize',
      title: 'Composing answer'
    })

    while (true) {
      const session = await this.createAssistantContentSession()
      let reasoningText = ''
      try {
        const synthesizeOptions = signal ? { signal } : undefined
        for await (const chunk of this.provider.synthesize(context, synthesizeOptions)) {
          if (chunk.kind === 'reasoning') {
            reasoningText += chunk.text
            yield createEvent('reasoning.chunk', {
              source: session.snapshot().source,
              text: reasoningText
            })
            continue
          }
          if (chunk.kind === 'usage') {
            // Best-effort token usage for this model call; the context-usage
            // gauge reads the latest one. Never affects the answer stream.
            yield createEvent('agent.usage', {
              promptTokens: chunk.promptTokens,
              ...(chunk.completionTokens !== undefined
                ? { completionTokens: chunk.completionTokens }
                : {}),
              ...(chunk.totalTokens !== undefined ? { totalTokens: chunk.totalTokens } : {})
            })
            continue
          }
          if (chunk.kind === 'tool_call' || chunk.kind === 'finish') {
            // Synthesis advertises `tool_choice: 'none'`, so the model should not
            // emit tool calls here; ignore any defensively rather than appending
            // them to the answer (issue #276).
            continue
          }
          yield createEvent('assistant.chunk', session.append(chunk.text))
        }

        if (reasoningText.trim().length > 0) {
          yield createEvent('reasoning.done', {
            source: session.snapshot().source,
            text: reasoningText
          })
        }
        await this.applyAssistantContentFinalizer(session, context)
        yield createEvent('agent.step.completed', { stepId: synthesizeStepId })
        yield createEvent('assistant.done', session.snapshot())
        return
      } catch (error) {
        if (!isRateLimitError(error)) {
          // Close the synthesize step before propagating (including on an
          // AbortError/cancellation) so handleRunError doesn't leave it open and
          // break the activity timeline.
          yield createEvent('agent.step.failed', {
            stepId: synthesizeStepId,
            error: error instanceof Error ? error.message : 'Synthesis failed'
          })
          throw error
        }

        // Clear any live reasoning state so a stale partial reasoning chunk from
        // the failed attempt does not persist into the retry or terminal response.
        if (reasoningText.trim().length > 0) {
          yield createEvent('reasoning.done', {
            source: session.snapshot().source,
            text: ''
          })
        }

        const outcome = yield* this.awaitRateLimitRetry(error, signal, context)
        if (outcome.retry) {
          continue
        }

        const cancelled = outcome.reason === 'cancelled'
        yield createEvent('agent.step.failed', {
          stepId: synthesizeStepId,
          error: cancelled ? 'Retry cancelled' : 'Rate limited'
        })
        yield createEvent(
          'assistant.done',
          session.replace(
            cancelled
              ? 'Retry cancelled.'
              : 'The model service is rate limited beyond the cooldown limit. Please try again later.'
          )
        )
        return
      }
    }
  }

  // Applies the host's answer finalizer (issue #478) to the completed answer,
  // replacing the session source when it changed. Deliberately placed AFTER the
  // synthesis stream settles and BEFORE `assistant.done`: that event supersedes
  // the live `assistant.chunk` stream in the projection, so its snapshot is what
  // is persisted and re-rendered on reload.
  //
  // Guarded like the telemetry sink: a finalizer that throws leaves the answer
  // exactly as the model composed it and reports the failure, because losing a
  // citation footer is a far smaller harm than losing the answer. It is not
  // reached at all on a rate-limited attempt that retries, so it runs once per
  // delivered answer rather than once per attempt.
  private async applyAssistantContentFinalizer(
    session: AssistantContentSession,
    context: ExecutionContext
  ): Promise<void> {
    if (!this.finalizeAssistantContent) {
      return
    }
    const snapshot = session.snapshot()
    try {
      const finalized = await this.finalizeAssistantContent({
        context,
        source: snapshot.source,
        snapshot
      })
      if (finalized !== snapshot.source) {
        session.replace(finalized)
      }
    } catch (error) {
      try {
        this.reportError(
          error instanceof Error ? error : new Error('Assistant content finalizer failed')
        )
      } catch {
        // Telemetry must never break the run.
      }
    }
  }

  protected waitUntil(retryAt: string, signal: AbortSignal | undefined): Promise<boolean> {
    if (signal?.aborted) {
      return Promise.resolve(false)
    }

    const retryAtMs = Date.parse(retryAt)
    const timeoutMs = Number.isNaN(retryAtMs) ? 0 : Math.max(0, retryAtMs - Date.now())

    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', onAbort)
      }

      const onAbort = () => {
        cleanup()
        resolve(false)
      }

      const timeoutId = setTimeout(() => {
        cleanup()
        resolve(true)
      }, timeoutMs)

      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

export const createPlainTextAssistantContentSession = (
  initialSource = ''
): AssistantContentSession => {
  let source = initialSource

  const snapshot = () => ({
    source,
    content:
      source.trim().length > 0
        ? {
            // Every block node must carry an id: the react renderer keys the
            // top-level nodes strictly by `node.id` (no fallback), and since #341
            // the renderer no longer normalizes on read — the producer owns it.
            // agent-core may not depend on content-core (boundary), so we assign a
            // stable literal id here rather than call `assignNodeIds`; a single
            // paragraph needs no hashing to be unique within its own tree. Any
            // surface that actually renders (the browser) injects the markdown
            // session, whose parser normalizes; this plain-text fallback is the
            // headless/test default.
            nodes: [
              {
                type: 'paragraph' as const,
                id: 'paragraph-0' as const,
                children: [{ type: 'text' as const, value: source }]
              }
            ]
          }
        : { nodes: [] }
  })

  return {
    append(chunk) {
      source += chunk
      return snapshot()
    },
    replace(nextSource) {
      source = nextSource
      return snapshot()
    },
    snapshot
  }
}
