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
  rateLimitPayloadSchema,
  type ExecutionPlan,
  type PlanStep,
  type ReActDecision
} from '@tinytinkerer/contracts'
import { SYSTEM_STYLE_PROMPT } from './system-prompt'
import { getRetryAfterMs } from './rate-limit'
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

const isValidRetryAt = (value: string | undefined): value is string =>
  Boolean(value && !Number.isNaN(Date.parse(value)))

const createRateLimitError = async (response: Response): Promise<RateLimitError> => {
  const rawText = await response.text()
  const parsed = (() => {
    try {
      return rateLimitPayloadSchema.parse(JSON.parse(rawText))
    } catch {
      return undefined
    }
  })()

  const retryAfterMs = parsed?.retryAfterMs ?? getRetryAfterMs(response.headers.get('retry-after'))
  const retryAt = isValidRetryAt(parsed?.retryAt)
    ? parsed.retryAt
    : new Date(Date.now() + retryAfterMs).toISOString()

  return new RateLimitError(parsed?.error ?? (rawText || 'GitHub Models is rate limited'), {
    retryAfterMs,
    retryAt
  })
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
    const hasMcpTools = allDescriptors.some((d) => d.id.startsWith('mcp:'))

    if (token && hasMcpTools) {
      try {
        const edgeFetch = createEdgeFetch(this.options.baseUrl, () => token)
        const model = this.options.getModel?.() ?? 'openai/gpt-4.1-mini'
        return await llmPlan(prompt, history, allDescriptors, model, edgeFetch, options?.signal)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
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

// Surfaces the model's raw chain-of-thought when present. Different OpenAI-compatible
// gateways expose it under different keys (DeepSeek-R1 uses `reasoning_content`, some
// others use `reasoning`); absence is normal and yields nothing.
const extractReasoning = (delta: unknown): string | undefined => {
  if (!delta || typeof delta !== 'object') {
    return undefined
  }

  const record = delta as Record<string, unknown>
  const reasoningContent = record['reasoning_content']
  if (typeof reasoningContent === 'string' && reasoningContent) {
    return reasoningContent
  }

  const reasoning = record['reasoning']
  if (typeof reasoning === 'string' && reasoning) {
    return reasoning
  }

  return undefined
}

const THINK_OPEN = '<think>'
const THINK_CLOSE = '</think>'

// Longest suffix of `text` that is a proper prefix of `tag` — i.e. the part we
// must hold back because it could be the start of `tag` continued in the next
// chunk.
const partialTagSuffixLength = (text: string, tag: string): number => {
  const max = Math.min(text.length, tag.length - 1)
  for (let len = max; len > 0; len -= 1) {
    if (tag.startsWith(text.slice(text.length - len))) {
      return len
    }
  }
  return 0
}

// Some reasoning models (e.g. DeepSeek-R1 via GitHub Models) stream their
// chain-of-thought inline in the content wrapped in <think>…</think> rather than
// in a separate reasoning_content delta. Re-route those regions to the reasoning
// channel so they render in the activity panel instead of the final answer.
// Tags may straddle chunk boundaries, so a partial-tag suffix is buffered.
// Chunks already classified as reasoning pass through untouched.
export async function* splitInlineThink(
  stream: AsyncIterable<SynthesisChunk>
): AsyncGenerator<SynthesisChunk> {
  let insideThink = false
  let buffer = ''

  function* drain(flush: boolean): Generator<SynthesisChunk> {
    for (;;) {
      const tag = insideThink ? THINK_CLOSE : THINK_OPEN
      const index = buffer.indexOf(tag)
      if (index !== -1) {
        const segment = buffer.slice(0, index)
        if (segment) {
          yield { kind: insideThink ? 'reasoning' : 'content', text: segment }
        }
        buffer = buffer.slice(index + tag.length)
        insideThink = !insideThink
        continue
      }

      const hold = flush ? 0 : partialTagSuffixLength(buffer, tag)
      const emit = buffer.slice(0, buffer.length - hold)
      if (emit) {
        yield { kind: insideThink ? 'reasoning' : 'content', text: emit }
      }
      buffer = buffer.slice(buffer.length - hold)
      break
    }
  }

  for await (const chunk of stream) {
    if (chunk.kind === 'reasoning') {
      yield chunk
      continue
    }
    buffer += chunk.text
    yield* drain(false)
  }
  yield* drain(true)
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined
): AsyncGenerator<SynthesisChunk> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const onAbort = () => {
    reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      if (signal?.aborted) {
        return
      }

      const { done, value } = await reader.read()
      if (done) {
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue
        }

        const data = line.slice(6).trim()
        if (data === '[DONE]') {
          return
        }

        try {
          const json = JSON.parse(data) as Record<string, unknown>
          const choices = json['choices']
          if (!Array.isArray(choices)) {
            continue
          }

          const delta = (choices[0] as Record<string, unknown> | undefined)?.['delta']
          const reasoning = extractReasoning(delta)
          if (reasoning) {
            yield { kind: 'reasoning', text: reasoning }
          }
          const content = (delta as Record<string, unknown> | undefined)?.['content']
          if (typeof content === 'string' && content) {
            yield { kind: 'content', text: content }
          }
        } catch {
          // Skip malformed SSE lines.
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
