import {
  inferPlan,
  DEFAULT_MODEL,
  RateLimitError,
  type ConversationMessage,
  type DecisionChunk,
  type ExecutionContext,
  type ModelProvider,
  type ProviderCallOptions,
  type SynthesisChunk
} from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  modelsChatResponseSchema,
  type ExecutionPlan,
  type PlanStep,
  type ReActDecision
} from '@tinytinkerer/contracts'
import { composeSystemPrompt, SYSTEM_STYLE_PROMPT, systemStylePrompt } from './system-prompt'
import type { AppInstructionBoundary } from '../app-assistant-policy'
import { createRateLimitError } from './rate-limit'
import { RateLimitQuota } from './quota-tracker'
import {
  createEdgeError,
  createEdgeFetch,
  createModelsChatFetch,
  type ForwardedRequestSink,
  type ModelsChatFetch
} from './edge-fetch'
import {
  parseJsonWithTelemetry,
  parseWithTelemetry,
  type AcceptedOutcome,
  type RequestTelemetryMetadata
} from '../telemetry/request-telemetry'
import { ModelJsonError } from './model-json'
import { llmPlan, type PlannerToolDescriptor } from './mcp-planner'
import { buildToolNameMap, toolInvocationsToMessages } from './tool-calling'
import {
  decideNextAction as llmDecideNextAction,
  streamDecision as llmStreamDecision
} from './react-decider'
import { extractReasoning, parseSseStream, splitInlineThink } from './sse-utils'

const estimateTokens = (context: ExecutionContext): number => {
  // Heuristic only (throttle sizing): include the tool I/O now carried as native
  // tool-call turns (issue #276) so the estimate tracks what is actually sent.
  const toolText = context.toolInvocations.map((invocation) =>
    JSON.stringify(invocation.input).concat(
      invocation.outcome.ok
        ? JSON.stringify(invocation.outcome.output ?? '')
        : invocation.outcome.error
    )
  )
  const allText = [
    SYSTEM_STYLE_PROMPT,
    ...context.history.map((m) => m.content),
    context.prompt,
    ...toolText
  ].join('')
  return Math.ceil(allText.length / 4)
}

type LiteLLMProviderOptions = {
  baseUrl: string
  getToken?: () => string | null | undefined
  getModel?: () => string | null | undefined
  getLiteLLMBaseUrl?: () => string | null | undefined
  allToolDescriptors?: PlannerToolDescriptor[]
  // Optional developer capture hook (issue #270): when present, every forwarded
  // chat request (plan / decide / synthesize) is reported to it for the
  // context-inspector plugin. The host injects it ONLY while that plugin is
  // enabled, so capture is off — and nothing is retained — otherwise.
  onForwardRequest?: ForwardedRequestSink
  // The host app's per-boundary system instructions (issue #478), already bound
  // to the tools that registered for this runtime. Absent for every app that
  // contributes none, which leaves all three prompts exactly as they were.
  appInstructions?: (boundary: AppInstructionBoundary) => string | undefined
  // The host app's replacement for the answer prompt's identity line (issue
  // #518, F6). Absent keeps "You are tinytinkerer…".
  identity?: string
}

// Pacing at or below this is slept inline; longer waits become runtime cooldowns.
const MAX_INLINE_PACING_MS = 1_000

// SYNTHESIZE is the *second* models.chat call site, alongside the DECIDE path
// (streamDecision/decideNextAction → react-decider). A fix applied only to
// DECIDE leaves this one firing the identical 429, so both must accept the same
// outcomes. AbortError = the user cancelling an in-flight stream. A 429 is the
// unavoidable call that OPENS each LiteLLM backoff window — the edge already
// short-circuits /api/models/chat while a window is open
// (apps/edge/.../rate-limit.ts), and the runtime turns the 429 into a
// RateLimitError → cooldown banner, so it is handled, not a captured error
// (TINYTINKERER-FRONTEND-B).
const SYNTHESIZE_ACCEPT: AcceptedOutcome = {
  kinds: ['abort'],
  status: [429],
  reason:
    'AbortError = user cancels an in-flight stream; 429 = the call that opens the durable backoff window; cooldown UX handles it (FRONTEND-B).'
}

export class LiteLLMProvider implements ModelProvider {
  readonly decisionStreamLifecycle = 'explicit-request-start' as const
  private readonly quota = new RateLimitQuota()
  // canSendPrompt gates the UI so only one synthesis runs at a time.
  private synthesizing = false

  constructor(private readonly options: LiteLLMProviderOptions) {}

  // Models/chat calls bound to this runtime's deployment: the LiteLLM base
  // URL (when the user explicitly configured one) is baked in here so the
  // planner/decider signatures never carry it.
  private modelsChatFetch(token?: string | null): ModelsChatFetch {
    const edgeFetch = createEdgeFetch(this.options.baseUrl, () => token)
    return createModelsChatFetch(
      edgeFetch,
      this.options.getLiteLLMBaseUrl,
      this.options.onForwardRequest
    )
  }

  // The explicit pre-request quota phase (issue #533), shared by synthesis and
  // both ReAct decision paths so a 429 on one stops the others from
  // retry-spamming the edge (TINYTINKERER-FRONTEND-9). It runs before any
  // request, so a wait here is never a model response. Sub-second pacing is
  // slept inline but stays abortable. A longer quota/backoff wait is raised as
  // a RateLimitError before dispatch: the runtime's cooldown then waits it out
  // outside every response timer, visibly, abortably and within its bounds,
  // and retries once it has passed, when this check lets the request through.
  private async awaitQuota(context: ExecutionContext, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const { waitMs, reason } = this.quota.checkThrottle(estimateTokens(context))
    if (waitMs > MAX_INLINE_PACING_MS) {
      const retryAt = Math.ceil(Date.now() + waitMs)
      throw new RateLimitError(
        reason === 'heuristic'
          ? 'Waiting out the model rate limit'
          : `Waiting for the model ${reason === 'token_quota' ? 'token' : 'request'} quota to reset`,
        { retryAfterMs: Math.ceil(waitMs), retryAt: new Date(retryAt).toISOString() }
      )
    }
    if (waitMs > 0) {
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }, waitMs)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
      signal?.throwIfAborted()
    }
  }

  // Records a 429 and returns it carrying the one effective deadline: the later
  // of the upstream retryAt and the tracker's amplified, jittered backoff. The
  // runtime waits until exactly then, so the retry is not throttled again.
  private rateLimited(error: RateLimitError): RateLimitError {
    const now = Date.now()
    const until = Math.max(
      this.quota.recordRateLimit(error.retryAfterMs, now),
      Date.parse(error.retryAt) || 0
    )
    return new RateLimitError(error.message, {
      retryAfterMs: until - now,
      retryAt: new Date(until).toISOString()
    })
  }

  async plan(
    prompt: string,
    history: ConversationMessage[],
    options?: ProviderCallOptions
  ): Promise<ExecutionPlan> {
    const token = this.options.getToken?.()
    const allDescriptors = this.options.allToolDescriptors ?? []

    // Use the model-authored planner whenever there is at least one tool for it
    // to reason about — web-search alone qualifies, not just MCP tools. With no
    // tools the LLM has nothing to plan around, so fall through to the heuristic planner.
    if (allDescriptors.length > 0) {
      try {
        const model = this.options.getModel?.() ?? DEFAULT_MODEL
        return await llmPlan(
          prompt,
          history,
          allDescriptors,
          model,
          this.modelsChatFetch(token),
          options?.signal,
          this.options.appInstructions?.('planning')
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        if (error instanceof RateLimitError) throw error
        // A model-content parse/schema failure means the model answered with
        // something we cannot turn into a plan. Surface it to the run-error path
        // instead of silently degrading to a heuristic (guessed) plan — a wrong
        // plan is worse than a clear failure (issue #139). Transport failures
        // (network/HTTP) still fall through to the heuristic below, since there we
        // never received model output to misinterpret.
        if (error instanceof ModelJsonError) throw error
        // fall through to heuristic
      }
    }

    // Heuristic fallback: hand the active tool descriptors to inferPlan, which
    // proposes a step for any whose declared keywords match the prompt. The host
    // names no concrete tool id — web search ships its own keyword step on its
    // descriptor, and an inactive plugin simply isn't in this list.
    return inferPlan(prompt, allDescriptors)
  }

  execute(step: PlanStep, context: ExecutionContext): Promise<string> {
    if (step.toolCall) {
      const result = context.toolResults[step.id]
      return Promise.resolve(result !== undefined ? `${step.id}: ${JSON.stringify(result)}` : '')
    }

    return Promise.resolve('')
  }

  async decideNextAction(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): Promise<ReActDecision> {
    await this.awaitQuota(context, options?.signal)
    const token = this.options.getToken?.()
    const model = this.options.getModel?.() ?? DEFAULT_MODEL
    const tools = this.options.allToolDescriptors ?? []
    // Dispatch follows synchronously: the single-shot budget starts here.
    options?.onRequestStart?.()
    try {
      return await llmDecideNextAction(
        context,
        tools,
        model,
        this.modelsChatFetch(token),
        options?.signal,
        this.options.appInstructions?.('decision')
      )
    } catch (error) {
      throw error instanceof RateLimitError ? this.rateLimited(error) : error
    }
  }

  async *streamDecision(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): AsyncIterable<DecisionChunk> {
    // Before request-start, so quota waiting never starts a response clock.
    await this.awaitQuota(context, options?.signal)
    const token = this.options.getToken?.()
    const model = this.options.getModel?.() ?? DEFAULT_MODEL
    const tools = this.options.allToolDescriptors ?? []
    try {
      yield* llmStreamDecision(
        context,
        tools,
        model,
        this.modelsChatFetch(token),
        options?.signal,
        this.options.appInstructions?.('decision')
      )
    } catch (error) {
      throw error instanceof RateLimitError ? this.rateLimited(error) : error
    }
  }

  async *synthesize(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): AsyncIterable<SynthesisChunk> {
    if (this.synthesizing) {
      throw new Error(
        'Assertion failed: synthesize called concurrently — canSendPrompt must gate this at the UI layer'
      )
    }
    this.synthesizing = true

    try {
      yield* splitInlineThink(this.synthesizeInner(context, options))
    } finally {
      this.synthesizing = false
    }
  }

  private async *synthesizeInner(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): AsyncIterable<SynthesisChunk> {
    await this.awaitQuota(context, options?.signal)
    const token = this.options.getToken?.()

    // Native tool calling (issue #276): feed the model its own tool I/O as native
    // assistant `tool_calls` + `tool` result turns — the SAME message shape the
    // decide path uses — instead of the old "Research notes:/Tool results:" prose
    // glued onto the user message. The tools are advertised (so the replayed
    // tool_calls/tool turns stay valid for strict providers) but `tool_choice:
    // 'none'` forbids new calls, forcing the model to compose the final answer.
    const names = buildToolNameMap(this.options.allToolDescriptors ?? [])
    const toolMessages = toolInvocationsToMessages(context.toolInvocations, names.toWire)

    const selectedModel = this.options.getModel?.() ?? DEFAULT_MODEL
    // Route through the shared models/chat fetch so request shape, auth, and
    // telemetry accept-rules live in one place (createEdgeFetch). The
    // SYNTHESIZE_ACCEPT rule travels with the call so its 429-window-opener is
    // triaged identically to DECIDE (TINYTINKERER-FRONTEND-B).
    const response = await this.modelsChatFetch(token)(
      {
        model: selectedModel,
        stream: true,
        // Ask LiteLLM to append a final usage chunk (prompt/completion tokens)
        // after the content stream so the context-usage gauge can show how full
        // the window is. Best-effort: providers that ignore it simply yield no
        // usage chunk and the gauge stays hidden.
        stream_options: { include_usage: true },
        messages: [
          {
            role: 'system',
            content: composeSystemPrompt(
              systemStylePrompt(this.options.identity),
              this.options.appInstructions?.('synthesis')
            )
          },
          ...context.history,
          { role: 'user', content: context.prompt },
          ...toolMessages
        ],
        // Advertise the tools so the replayed tool_calls/tool messages remain
        // valid, but forbid new calls during synthesis (issue #276).
        ...(names.definitions.length > 0
          ? { tools: names.definitions, tool_choice: 'none' as const }
          : {})
      },
      {
        area: 'models.chat',
        accept: SYNTHESIZE_ACCEPT,
        ...(options?.signal ? { signal: options.signal } : {})
      }
    )

    this.quota.updateFromHeaders(response.headers)

    if (response.status === 429) {
      throw this.rateLimited(await createRateLimitError(response))
    }

    if (!response.ok) {
      throw await createEdgeError(response, `Models request failed (${response.status})`)
    }

    // 200 OK — server accepted the request; clear any heuristic backoff.
    this.quota.clearHeuristicBackoff()

    if (response.body) {
      yield* parseSseStream(response.body, options?.signal)
      return
    }

    // Defensive non-streamed fallback (synthesize always requests stream:true).
    // Rebuild the metadata the parse helpers need — mirrors react-decider,
    // which likewise reconstructs it after going through the shared fetch.
    const metadata: RequestTelemetryMetadata = {
      area: 'models.chat',
      origin: 'edge',
      method: 'POST',
      url: `${this.options.baseUrl}${EDGE_ROUTE_PATHS.modelsChat}`,
      model: selectedModel,
      stream: true,
      accept: SYNTHESIZE_ACCEPT
    }
    const rawJson = await parseJsonWithTelemetry<Record<string, unknown>>(metadata, response)
    const reasoning = extractReasoning(
      (rawJson['choices'] as Array<Record<string, unknown>> | undefined)?.[0]?.['message']
    )
    if (reasoning) {
      yield { kind: 'reasoning', text: reasoning }
    }
    const parsed = parseWithTelemetry(
      metadata,
      'schema_error',
      'Models response did not match schema',
      () => modelsChatResponseSchema.parse(rawJson),
      response
    )
    const text = parsed.choices?.[0]?.message?.content ?? ''
    yield { kind: 'content', text }
    // Non-streamed responses carry usage in the body; surface it too so the
    // gauge works on the (defensive) non-stream path.
    if (typeof parsed.usage?.prompt_tokens === 'number') {
      yield {
        kind: 'usage',
        promptTokens: parsed.usage.prompt_tokens,
        ...(typeof parsed.usage.completion_tokens === 'number'
          ? { completionTokens: parsed.usage.completion_tokens }
          : {}),
        ...(typeof parsed.usage.total_tokens === 'number'
          ? { totalTokens: parsed.usage.total_tokens }
          : {})
      }
    }
  }
}
