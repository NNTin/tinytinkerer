import {
  inferPlan,
  RateLimitError,
  type ExecutionContext,
  type ModelProvider,
  type ProviderCallOptions
} from '@tinytinkerer/app-core'
import {
  edgeErrorResponseSchema,
  modelsChatResponseSchema,
  rateLimitPayloadSchema,
  type ExecutionPlan,
  type PlanStep
} from '@tinytinkerer/contracts'
import { SYSTEM_STYLE_PROMPT } from './system-prompt'
import { getRetryAfterMs } from './rate-limit'
import { RateLimitQuota } from './quota-tracker'

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

  constructor(private readonly options: GitHubModelsProviderOptions) {}

  plan(prompt: string, options?: ProviderCallOptions): Promise<ExecutionPlan> {
    const searchEnabled = options?.searchEnabled
    return Promise.resolve(
      inferPlan(prompt, searchEnabled !== undefined ? { searchEnabled } : undefined)
    )
  }

  execute(step: PlanStep, context: ExecutionContext): Promise<string> {
    if (step.toolCall) {
      const result = context.toolResults[step.id]
      return Promise.resolve(result !== undefined ? `${step.id}: ${JSON.stringify(result)}` : '')
    }

    return Promise.resolve('')
  }

  async *synthesize(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<string> {
    const token = this.options.getToken?.()

    if (token) {
      const estimatedTokens = estimateTokens(context)
      const throttle = this.quota.checkThrottle(estimatedTokens)
      if (throttle.shouldThrottle) {
        if (throttle.waitMs > 1000) {
          // Surface to UI: disable Send button and show countdown timer
          const retryAt = new Date(Date.now() + throttle.waitMs).toISOString()
          throw new RateLimitError(`Proactive rate limit (${throttle.reason})`, {
            retryAfterMs: Math.ceil(throttle.waitMs),
            retryAt,
          })
        }
        // Sub-second soft delay: sleep silently without disrupting the UI
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
          authorization: `Bearer ${token}`
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

      const response = await fetch(`${this.options.baseUrl}/api/models/chat`, requestInit)

      this.quota.updateFromHeaders(response.headers)

      if (response.status === 429) {
        const err = await createRateLimitError(response)
        this.quota.recordRateLimit(err.retryAfterMs)
        throw err
      }

      if (!response.ok) {
        throw await createEdgeError(response, `Models request failed (${response.status})`)
      }

      if (response.body) {
        yield* parseSseStream(response.body, options?.signal)
        return
      }

      const parsed = modelsChatResponseSchema.parse(await response.json())
      const text = parsed.choices?.[0]?.message?.content ?? ''
      yield text
      return
    }

    const collected = Object.entries(context.toolResults)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n')

    const draft = collected
      ? `I worked through the plan and used tools where needed.\n\n${collected}`
      : 'Sign in with GitHub to get AI responses. Without a token the runtime runs in local fallback mode.'

    for (const chunk of draft.split(' ')) {
      yield `${chunk} `
    }
  }
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined
): AsyncGenerator<string> {
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
          const content = (delta as Record<string, unknown> | undefined)?.['content']
          if (typeof content === 'string' && content) {
            yield content
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
