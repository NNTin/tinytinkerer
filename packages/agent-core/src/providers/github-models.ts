import type { ExecutionPlan, PlanStep } from '@tinytinkerer/types'
import { z } from 'zod'
import { DEFAULT_RATE_LIMIT_RETRY_AFTER_MS, parseRetryAfterMs, sleep } from '@tinytinkerer/shared'
import { RateLimitError } from '../errors/rate-limit-error'
import { SYSTEM_STYLE_PROMPT } from '../prompts/system'
import type { ExecutionContext, ModelProvider } from '../types'

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
      return rateLimitResponseSchema.partial().parse(JSON.parse(rawText))
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

  async plan(prompt: string): Promise<ExecutionPlan> {
    try {
      const response = await fetch(`${this.options.baseUrl}/api/models/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt })
      })

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

  async execute(step: PlanStep): Promise<string> {
    await sleep(150)
    return `Completed step: ${step.summary}`
  }

  async *synthesize(context: ExecutionContext, options?: { signal?: AbortSignal }): AsyncIterable<string> {
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

        if (response.ok) {
          const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>
          }
          const content = payload.choices?.[0]?.message?.content ?? ''
          if (content) {
            for (const chunk of content.split(' ')) {
              yield `${chunk} `
            }
            return
          }
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
      await sleep(25)
      yield `${chunk} `
    }
  }
}
