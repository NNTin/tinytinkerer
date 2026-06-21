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
import { SYSTEM_STYLE_PROMPT } from './system-prompt'
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
  ModelJsonError,
  parseJsonWithTelemetry,
  parseWithTelemetry,
  type AcceptedOutcome,
  type RequestTelemetryMetadata
} from '../telemetry/request-telemetry'
import { llmPlan, type PlannerToolDescriptor } from './mcp-planner'
import {
  decideNextAction as llmDecideNextAction,
  streamDecision as llmStreamDecision
} from './react-decider'
import { extractReasoning, parseSseStream, splitInlineThink } from './sse-utils'

const estimateTokens = (context: ExecutionContext): number => {
  const allText = [
    SYSTEM_STYLE_PROMPT,
    ...context.history.map((m) => m.content),
    context.prompt,
    ...context.notes
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
}

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

  // Wait out any active rate-limit/quota backoff before issuing an edge model
  // call. Shared by synthesis and the ReAct decision path so a 429 on one stops
  // the others from retry-spamming the edge (TINYTINKERER-FRONTEND-9).
  private async applyQuotaThrottle(context: ExecutionContext): Promise<void> {
    const throttle = this.quota.checkThrottle(estimateTokens(context))
    if (throttle.shouldThrottle) {
      await new Promise<void>((resolve) => setTimeout(resolve, throttle.waitMs))
    }
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
          options?.signal
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
    const token = this.options.getToken?.()
    await this.applyQuotaThrottle(context)
    const model = this.options.getModel?.() ?? DEFAULT_MODEL
    const tools = this.options.allToolDescriptors ?? []
    try {
      return await llmDecideNextAction(
        context,
        tools,
        model,
        this.modelsChatFetch(token),
        options?.signal
      )
    } catch (error) {
      if (error instanceof RateLimitError) this.quota.recordRateLimit(error.retryAfterMs)
      throw error
    }
  }

  async *streamDecision(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): AsyncIterable<DecisionChunk> {
    const token = this.options.getToken?.()
    await this.applyQuotaThrottle(context)
    const model = this.options.getModel?.() ?? DEFAULT_MODEL
    const tools = this.options.allToolDescriptors ?? []
    try {
      yield* llmStreamDecision(context, tools, model, this.modelsChatFetch(token), options?.signal)
    } catch (error) {
      if (error instanceof RateLimitError) this.quota.recordRateLimit(error.retryAfterMs)
      throw error
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
    const token = this.options.getToken?.()
    const estimatedTokens = estimateTokens(context)
    const throttle = this.quota.checkThrottle(estimatedTokens)
    if (throttle.shouldThrottle) {
      // Sleep inline for all throttle durations — keeps prevention inside the provider
      // and avoids misusing the upstream recovery loop.
      await new Promise<void>((resolve) => setTimeout(resolve, throttle.waitMs))
    }

    const toolSection = Object.entries(context.toolResults)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n')

    const userContent = [
      context.prompt,
      context.notes.filter(Boolean).length > 0 && `\nResearch notes:\n${context.notes.join('\n')}`,
      toolSection && `\nTool results:\n${toolSection}`
    ]
      .filter(Boolean)
      .join('')

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
          { role: 'system', content: SYSTEM_STYLE_PROMPT },
          ...context.history,
          { role: 'user', content: userContent }
        ]
      },
      {
        area: 'models.chat',
        accept: SYNTHESIZE_ACCEPT,
        ...(options?.signal ? { signal: options.signal } : {})
      }
    )

    this.quota.updateFromHeaders(response.headers)

    if (response.status === 429) {
      const err = await createRateLimitError(response)
      this.quota.recordRateLimit(err.retryAfterMs)
      throw err
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
