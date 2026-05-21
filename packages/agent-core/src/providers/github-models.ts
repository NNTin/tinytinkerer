import type { ExecutionPlan, PlanStep } from '@tinytinkerer/types'
import { z } from 'zod'
import { DEFAULT_RATE_LIMIT_RETRY_AFTER_MS, parseRetryAfterMs } from '@tinytinkerer/shared'
import { RateLimitError } from '../errors/rate-limit-error'
import { SYSTEM_STYLE_PROMPT } from '../prompts/system'
import type { ExecutionContext, ModelProvider, ProviderCallOptions } from '../types'

const defaultPlanSchema = z.object({
  complexity: z.enum(['low', 'medium', 'high']),
  steps: z.array(
    z.object({
      id: z.string(),
      summary: z.string(),
      toolCall: z
        .object({
          toolId: z.string(),
          input: z.record(z.string(), z.unknown())
        })
        .optional()
    })
  )
})

const rateLimitResponseSchema = z.object({
  error: z.string().optional(),
  retryAfterMs: z.number().nonnegative().optional(),
  retryAt: z.string().optional()
})

type GitHubModelsProviderOptions = {
  baseUrl: string
  getToken?: () => string | null | undefined
}

const inferPlan = (prompt: string): ExecutionPlan => {
  const needsSearch = /latest|news|compare|research|search|web|today/i.test(prompt)
  const steps: PlanStep[] = [
    {
      id: 'understand',
      summary: 'Understand request constraints'
    }
  ]

  if (needsSearch) {
    steps.push({
      id: 'search',
      summary: 'Collect current references from web search',
      toolCall: {
        toolId: 'web-search',
        input: {
          query: prompt,
          maxResults: 5
        }
      }
    })
  }

  steps.push({
    id: 'compose',
    summary: 'Compose final grounded response'
  })

  return {
    complexity: needsSearch ? 'medium' : 'low',
    steps
  }
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

  async plan(prompt: string, options?: ProviderCallOptions): Promise<ExecutionPlan> {
    try {
      const planInit: RequestInit = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt })
      }
      if (options?.signal) {
        planInit.signal = options.signal
      }
      const response = await fetch(`${this.options.baseUrl}/api/models/plan`, planInit)

      if (!response.ok) {
        return inferPlan(prompt)
      }

      const json = (await response.json()) as unknown
      const parsed = defaultPlanSchema.parse(json)
      return {
        complexity: parsed.complexity,
        steps: parsed.steps.map((step) => ({
          id: step.id,
          summary: step.summary,
          ...(step.toolCall ? { toolCall: step.toolCall } : {})
        }))
      }
    } catch {
      return inferPlan(prompt)
    }
  }

  execute(step: PlanStep): Promise<string> {
    return Promise.resolve(`Completed step: ${step.summary}`)
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
            messages: [
              { role: 'system', content: SYSTEM_STYLE_PROMPT },
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
