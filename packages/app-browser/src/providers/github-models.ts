import type { ExecutionPlan, PlanStep } from '@tinytinkerer/contracts'
import { z } from 'zod'
import { DEFAULT_RATE_LIMIT_RETRY_AFTER_MS, parseRetryAfterMs } from '@tinytinkerer/shared'
import { inferPlan } from '@tinytinkerer/app-core'
import { RateLimitError } from '@tinytinkerer/agent-core'
import { SYSTEM_STYLE_PROMPT } from './system-prompt.js'
import type { ExecutionContext, ModelProvider, ProviderCallOptions } from '@tinytinkerer/agent-core'

const rateLimitResponseSchema = z.object({
  error: z.string().optional(),
  retryAfterMs: z.number().nonnegative().optional(),
  retryAt: z.string().optional()
})

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
      return rateLimitResponseSchema.parse(JSON.parse(rawText))
    } catch {
      return undefined
    }
  })()

  const retryAfterMs =
    parsed?.retryAfterMs ?? parseRetryAfterMs(response.headers.get('retry-after')) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS
  const retryAt = isValidRetryAt(parsed?.retryAt)
    ? parsed.retryAt
    : new Date(Date.now() + retryAfterMs).toISOString()

  return new RateLimitError(parsed?.error ?? (rawText || 'GitHub Models is rate limited'), {
    retryAfterMs,
    retryAt
  })
}

export class GitHubModelsProvider implements ModelProvider {
  constructor(private readonly options: GitHubModelsProviderOptions) {}

  plan(prompt: string, options?: ProviderCallOptions): Promise<ExecutionPlan> {
    const searchEnabled = options?.searchEnabled
    return Promise.resolve(inferPlan(prompt, searchEnabled !== undefined ? { searchEnabled } : undefined))
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

      try {
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

        if (response.status === 429) {
          throw await createRateLimitError(response)
        }

        if (response.ok && response.body) {
          yield* parseSseStream(response.body, options?.signal)
          return
        }
      } catch (error) {
        if (error instanceof RateLimitError) {
          throw error
        }
        // fall through to local mock
      }
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
      if (signal?.aborted) return

      const { done, value } = await reader.read()
      if (done) return

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') return

        try {
          const json = JSON.parse(data) as Record<string, unknown>
          const choices = json['choices']
          if (!Array.isArray(choices)) continue
          const delta = (choices[0] as Record<string, unknown> | undefined)?.['delta']
          const content = (delta as Record<string, unknown> | undefined)?.['content']
          if (typeof content === 'string' && content) {
            yield content
          }
        } catch {
          // skip malformed SSE line
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
