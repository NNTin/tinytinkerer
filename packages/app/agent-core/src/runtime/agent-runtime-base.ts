import type { ChatEvent, ReActDecision } from '@tinytinkerer/contracts'
import { isRateLimitError, type RateLimitError } from '../errors/rate-limit-error'
import { createEvent } from '../events/create-event'
import type {
  AssistantContentSession,
  ConversationMessage,
  CreateAssistantContentSession,
  ExecutionContext,
  ModelProvider,
  ProviderCallOptions
} from '../types'
import { RuntimeTimeoutError } from '../errors/timeout-error'
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

export type AgentRuntimeOptions = {
  maxIterations?: number
  maxToolCallsPerStep?: number
  toolTimeoutMs?: number
  stepTimeoutMs?: number
  /**
   * Whole-response budget for a single-shot model call: the wait for the first
   * chunk of a streaming decision, the entire non-streaming decision, and the
   * planner / execution-step calls. Reasoning models (e.g. `openai/gpt-5` via
   * LiteLLM) routinely take much longer to produce a full response — or even
   * their first chunk — than the inter-chunk `stepTimeoutMs` idle gap, so reusing
   * the idle timeout here killed slow-but-healthy reasoning calls before they
   * finished: the streaming decision was cut off before its first token
   * (TINYTINKERER-FRONTEND-S) and the planner tripped "Planner timed out". This
   * larger budget governs those whole-response waits; `stepTimeoutMs` still
   * applies only as the idle gap between chunks once a stream is flowing. Kept
   * below the edge's upstream backstop (120s) so the frontend budget — not the
   * edge — is the user-facing authority and never aborts a healthy stream first.
   */
  firstChunkTimeoutMs?: number
  searchEnabled?: boolean
  createAssistantContentSession?: CreateAssistantContentSession
  reportError?: RuntimeErrorReporter
  hooks?: readonly AgentHookContribution[]
  hookTimeoutMs?: number
  /**
   * Budget for gates that block on a human decision (those flagged
   * `awaitsHumanInput`, e.g. the Permissions plugin's allow/deny prompt). A
   * person needs far longer than a machine hook to read and approve a tool, so
   * the generic `hookTimeoutMs` (60s) is too short and surfaces a confusing
   * internal "hook timed out" reason. This larger budget governs human gates;
   * it stays bounded so it still backstops a host that never renders the prompt.
   */
  humanHookTimeoutMs?: number
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

type DecisionLoopControl =
  | { kind: 'decision'; decision: ReActDecision }
  | { kind: 'stop'; reason: 'too_long' | 'cancelled' }

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
    serialized = JSON.stringify(output) ?? String(output)
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
  protected readonly searchEnabled: boolean
  protected readonly createAssistantContentSession: CreateAssistantContentSession
  protected readonly reportError: RuntimeErrorReporter
  protected readonly hooks: readonly AgentHookContribution[]
  protected readonly hookTimeoutMs: number
  protected readonly humanHookTimeoutMs: number

  constructor(
    protected readonly provider: ModelProvider,
    protected readonly registry: ToolRegistry,
    options: AgentRuntimeOptions = {}
  ) {
    this.maxIterations = options.maxIterations ?? 5
    this.maxToolCallsPerStep = options.maxToolCallsPerStep ?? 1
    this.toolTimeoutMs = options.toolTimeoutMs ?? 10_000
    this.stepTimeoutMs = options.stepTimeoutMs ?? 15_000
    // Allow a generous whole-response wait (>= the idle gap) so slow reasoning
    // models are not cut off before they finish a single-shot call — first
    // streamed token, full non-streaming decision, or the planner (FRONTEND-S).
    // 90s gives gpt-5-class models room to first token while staying under the
    // edge's 120s upstream backstop, so the frontend stays the authority.
    this.firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? Math.max(this.stepTimeoutMs, 90_000)
    this.searchEnabled = options.searchEnabled ?? true
    this.createAssistantContentSession =
      options.createAssistantContentSession ?? createPlainTextAssistantContentSession
    this.reportError = options.reportError ?? (() => {})
    this.hooks = options.hooks ?? []
    this.hookTimeoutMs = options.hookTimeoutMs ?? 60_000
    // 5 minutes: generous enough for a human to read a tool (e.g. run_javascript
    // source) and decide, while still bounding the wait so a host that never
    // renders the prompt fails closed rather than hanging the run forever.
    this.humanHookTimeoutMs = options.humanHookTimeoutMs ?? 300_000
  }

  abstract run(prompt: string, options?: RunOptions): AsyncGenerator<ChatEvent>

  protected createContext(prompt: string, history: ConversationMessage[]): ExecutionContext {
    return {
      prompt,
      history,
      plan: { complexity: 'low', steps: [] },
      notes: [],
      toolResults: {}
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

    // Always emit a started→failed pair (even when policy disables tool calls),
    // so the projection layer — which coalesces tool events by matching a failure
    // to the most recent started tool with the same stepId — can nest the failure
    // under its parent step and keep the input/parent linkage.
    yield createEvent('agent.tool.started', {
      stepId,
      ...(parentStepId ? { parentStepId } : {}),
      toolId,
      input
    })

    if (this.maxToolCallsPerStep < 1) {
      const error = 'Tool calls disabled by runtime policy'
      yield createEvent('agent.tool.failed', { stepId, toolId, error })
      return { ok: false, error }
    }

    const gate = await runToolBeforeExecuteHooks(
      this.hooks,
      {
        stepId,
        ...(parentStepId ? { parentStepId } : {}),
        toolId,
        input
      },
      this.hookTimeoutMs,
      this.humanHookTimeoutMs
    )
    if (!gate.allow) {
      const error = `Tool execution blocked: ${gate.reason}`
      yield createEvent('agent.tool.failed', { stepId, toolId, error })
      return { ok: false, error }
    }

    try {
      const output = await withTimeout(
        this.registry.run(toolId, input),
        this.toolTimeoutMs,
        `Tool ${toolId} timed out`
      )
      yield createEvent('agent.tool.completed', { stepId, toolId, output })
      return { ok: true, output }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed'
      yield createEvent('agent.tool.failed', { stepId, toolId, error: message })
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
        const outcome = yield* this.awaitRateLimitRetry(error, callOptions.signal)
        if (outcome.retry) {
          continue
        }
        // Cooldown too long or wait cancelled: stop deciding and let the run wind
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

      // Enforce a per-step timeout. A stalled stream aborts the underlying
      // request and fails the step rather than hanging the loop. The timer is an
      // idle timeout: it resets on every chunk, so a steadily-streaming thought
      // is never cut off. The FIRST chunk gets a larger budget
      // (firstChunkTimeoutMs) because slow reasoning models — e.g. `openai/gpt-5`
      // via LiteLLM — take much longer to emit their first token than the
      // inter-chunk gap; reusing the idle gap here killed healthy streams before
      // they started (TINYTINKERER-FRONTEND-S). Subsequent chunks use the shorter
      // stepTimeoutMs idle gap. The controller is linked to the caller's signal
      // so a user abort still cancels the request.
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

      let timedOut = false
      let firstChunk = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const disarm = () => {
        if (timer) {
          clearTimeout(timer)
          timer = undefined
        }
      }
      const arm = () => {
        disarm()
        const budget = firstChunk ? this.firstChunkTimeoutMs : this.stepTimeoutMs
        timer = setTimeout(() => {
          timedOut = true
          controller.abort()
        }, budget)
      }

      let thought = ''
      let decision: ReActDecision | undefined
      try {
        arm()
        for await (const chunk of provider.streamDecision(context, {
          ...callOptions,
          signal: controller.signal
        })) {
          disarm()
          firstChunk = false
          if (chunk.kind === 'thought') {
            thought = chunk.text
            yield createEvent('agent.step.delta', { stepId: thoughtStepId, text: thought })
          } else {
            decision = chunk.decision
          }
          arm()
        }
      } catch (error) {
        // A timeout-induced abort may surface as a thrown error; suppress it so
        // the timeout is reported uniformly below. Any other error fails this
        // think step (so the timeline has no dangling open step) before
        // propagating — nextDecision decides whether to retry, e.g. on a rate
        // limit.
        if (!timedOut) {
          yield createEvent('agent.step.failed', {
            stepId: thoughtStepId,
            error: error instanceof Error ? error.message : 'ReAct decision failed'
          })
          throw error
        }
      } finally {
        disarm()
        if (userSignal && !userSignal.aborted) {
          userSignal.removeEventListener('abort', onUserAbort)
        }
      }

      if (timedOut) {
        yield createEvent('agent.step.failed', {
          stepId: thoughtStepId,
          error: 'ReAct decision timed out'
        })
        // Typed so the terminal handler reports it as a warning, not a hard
        // error: a slow model is degraded, not a crash (FRONTEND-S).
        throw new RuntimeTimeoutError('ReAct decision timed out')
      }

      yield createEvent('agent.step.completed', {
        stepId: thoughtStepId,
        ...(thought.trim().length > 0 ? { summary: thought } : {})
      })

      return decision ?? { kind: 'final' }
    }

    // Non-streaming decisions wait for the whole model response in one shot, so
    // they get the same generous reasoning-model budget as a streaming first
    // chunk rather than the short inter-chunk idle gap (FRONTEND-S).
    const decision = await withTimeout(
      provider.decideNextAction!(context, callOptions),
      this.firstChunkTimeoutMs,
      'ReAct decision timed out'
    )
    const thoughtTitle =
      decision.reasoning ??
      (decision.kind === 'final' ? 'Finalizing answer' : 'Deciding next action')
    yield createEvent('agent.step.started', {
      stepId: thoughtStepId,
      ...parentField,
      kind: 'think',
      title: thoughtTitle
    })
    yield createEvent('agent.step.completed', { stepId: thoughtStepId })
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
      searchEnabled: boolean
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
      ...(options.signal ? { signal: options.signal } : {}),
      searchEnabled: options.searchEnabled
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
  // cooldown is short enough to auto-retry, waits it out. Returns whether the
  // caller should retry; on giving up it reports why (the cooldown was too long
  // or the wait was cancelled) so the caller can choose its own terminal
  // handling. Shared by synthesis and ReAct decisions so every rate-limited call
  // funnels through the same cooldown/retry behaviour.
  protected async *awaitRateLimitRetry(
    error: RateLimitError,
    signal: AbortSignal | undefined
  ): AsyncGenerator<
    ChatEvent,
    { retry: true } | { retry: false; reason: 'too_long' | 'cancelled' }
  > {
    const autoRetry = error.retryAfterMs <= MAX_AUTO_RETRY_AFTER_MS

    if (!autoRetry) {
      yield createEvent('rate.limit.cancelled', {
        retryAfterMs: error.retryAfterMs,
        retryAt: error.retryAt,
        message: error.message,
        reason: 'too_long'
      })
      return { retry: false, reason: 'too_long' }
    }

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
          yield createEvent('assistant.chunk', session.append(chunk.text))
        }

        if (reasoningText.trim().length > 0) {
          yield createEvent('reasoning.done', {
            source: session.snapshot().source,
            text: reasoningText
          })
        }
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

        const outcome = yield* this.awaitRateLimitRetry(error, signal)
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
              : 'The model service is rate limited. This request was cancelled because the cooldown is longer than five minutes.'
          )
        )
        return
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
            nodes: [
              {
                type: 'paragraph' as const,
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
