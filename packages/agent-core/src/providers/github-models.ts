import type { ExecutionPlan, PlanStep } from '@tinytinkerer/types'
import { z } from 'zod'
import { sleep } from '@tinytinkerer/shared'
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

  async *synthesize(context: ExecutionContext): AsyncIterable<string> {
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
        const response = await fetch(`${this.options.baseUrl}/api/models/chat`, {
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
        })

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
      } catch {
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
