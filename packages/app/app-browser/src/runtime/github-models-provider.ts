import {
  inferPlan,
  RateLimitError,
  type ConversationMessage,
  type DecisionChunk,
  type ExecutionContext,
  type ModelProvider,
  type ProviderCallOptions,
  type SynthesisChunk
} from '@tinytinkerer/app-core'
import {
  edgeErrorResponseSchema,
  modelsChatResponseSchema,
  type ExecutionPlan,
  type PlanStep,
  type ReActDecision
} from '@tinytinkerer/contracts'
import { SYSTEM_STYLE_PROMPT } from './system-prompt'
import { createRateLimitError } from './rate-limit'
import { RateLimitQuota } from './quota-tracker'
import { createEdgeFetch } from './edge-fetch'
import { getTelemetryHeaders } from '../telemetry/telemetry'
import {
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  parseWithTelemetry,
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
    ...context.notes,
  ].join('')
  return Math.ceil(allText.length / 4)
}

type GitHubModelsProviderOptions = {
  baseUrl: string
  getToken?: () => string | null | undefined
  getModel?: () => string | null | undefined
  allToolDescriptors?: PlannerToolDescriptor[]
}

const createEdgeError = async (response: Response, fallback: string): Promise<Error> => {
  const parsed = await response
    .clone()
    .json()
    .then((value) => edgeErrorResponseSchema.safeParse(value))
    .catch(() => undefined)

  return new Error(parsed?.success ? parsed.data.error : fallback)
}

export class GitHubModelsProvider implements ModelProvider {
  private readonly quota = new RateLimitQuota()
  // canSendPrompt gates the UI so only one synthesis runs at a time.
  private synthesizing = false

  constructor(private readonly options: GitHubModelsProviderOptions) {}

  async plan(prompt: string, history: ConversationMessage[], options?: ProviderCallOptions): Promise<ExecutionPlan> {
    const token = this.options.getToken?.()
    const allDescriptors = this.options.allToolDescriptors ?? []

    // Use the model-authored planner whenever there is a token and at least one
    // tool for it to reason about — web-search alone qualifies, not just MCP
    // tools. With no tools the LLM has nothing to plan around, so fall through
    // to the heuristic planner.
    if (token && allDescriptors.length > 0) {
      try {
        const edgeFetch = createEdgeFetch(this.options.baseUrl, () => token)
        const model = this.options.getModel?.() ?? 'openai/gpt-4.1-mini'
        return await llmPlan(prompt, history, allDescriptors, model, edgeFetch, options?.signal)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        if (error instanceof RateLimitError) throw error
        // fall through to heuristic
      }
    }

    const searchEnabled = options?.searchEnabled
    return inferPlan(prompt, searchEnabled !== undefined ? { searchEnabled } : undefined)
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

    if (token) {
      const edgeFetch = createEdgeFetch(this.options.baseUrl, () => token)
      const model = this.options.getModel?.() ?? 'openai/gpt-4.1-mini'
      const tools = this.options.allToolDescriptors ?? []
      return llmDecideNextAction(context, tools, model, edgeFetch, options?.signal)
    }

    // Without a token there is no model to consult, so finish immediately and
    // let synthesize() produce the local fallback answer.
    return { kind: 'final' }
  }

  async *streamDecision(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): AsyncIterable<DecisionChunk> {
    const token = this.options.getToken?.()

    if (token) {
      const edgeFetch = createEdgeFetch(this.options.baseUrl, () => token)
      const model = this.options.getModel?.() ?? 'openai/gpt-4.1-mini'
      const tools = this.options.allToolDescriptors ?? []
      yield* llmStreamDecision(context, tools, model, edgeFetch, options?.signal)
      return
    }

    // Local fallback: no model to stream, so finish immediately.
    yield { kind: 'decision', decision: { kind: 'final' } }
  }

  async *synthesize(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<SynthesisChunk> {
    if (this.synthesizing) {
      throw new Error('Assertion failed: synthesize called concurrently — canSendPrompt must gate this at the UI layer')
    }
    this.synthesizing = true

    try {
      yield* splitInlineThink(this.synthesizeInner(context, options))
    } finally {
      this.synthesizing = false
    }
  }

  private async *synthesizeInner(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<SynthesisChunk> {
    const token = this.options.getToken?.()

    if (token) {
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

      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          ...getTelemetryHeaders()
        },
        body: JSON.stringify({
          stream: true,
          model: this.options.getModel?.() ?? undefined,
          messages: [
            { role: 'system', content: SYSTEM_STYLE_PROMPT },
            ...context.history,
            { role: 'user', content: userContent }
          ]
        })
      }

      if (options?.signal) {
        requestInit.signal = options.signal
      }

      const metadata: RequestTelemetryMetadata = {
        area: 'models.chat',
        origin: 'edge',
        method: 'POST',
        url: `${this.options.baseUrl}/api/models/chat`,
        stream: true
      }
      const response = await fetchWithTelemetry(metadata, requestInit)

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
      return
    }

    const collected = Object.entries(context.toolResults)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n')

    const draft = collected
      ? `I worked through the plan and used tools where needed.\n\n${collected}`
      : 'Sign in with GitHub to get AI responses. Without a token the runtime runs in local fallback mode.'

    for (const chunk of draft.split(' ')) {
      yield { kind: 'content', text: `${chunk} ` }
    }
  }
}
