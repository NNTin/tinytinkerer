import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { searchRequestSchema } from '@tinytinkerer/contracts'
import { createChatRuntime, RateLimitError, type ModelProvider } from '../src/index.js'

const collectEvents = async (runtime: ReturnType<typeof createChatRuntime>): Promise<ChatEvent[]> => {
  const events: ChatEvent[] = []
  for await (const event of runtime.run('latest news')) {
    events.push(event)
  }
  return events
}

describe('createChatRuntime', () => {
  it('adapts provider and tool registration through app-core', async () => {
    const provider: ModelProvider = {
      plan() {
        return Promise.resolve({
          complexity: 'medium',
          steps: [
            { id: 'understand', summary: 'Understand request constraints' },
            {
              id: 'search',
              summary: 'Collect current references from web search',
              toolCall: { toolId: 'web-search', input: { query: 'latest news', maxResults: 5 } }
            }
          ]
        })
      },
      execute() {
        return Promise.resolve('used tool results')
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: await Promise.resolve('done') }
      }
    }

    const events = await collectEvents(
      createChatRuntime({
        provider,
        tools: [
          {
            id: 'web-search',
            description: 'Search the web',
            schema: searchRequestSchema,
            execute() {
              return Promise.resolve({ results: [] })
            }
          }
        ]
      })
    )

    expect(events.some((event) => event.type === 'agent.tool.started')).toBe(true)
    expect(events.some((event) => event.type === 'agent.tool.completed')).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'assistant.done',
      payload: { source: 'done' }
    })
  })

  it('selects the ReAct runtime when agentType is "react"', async () => {
    let decisions = 0
    const provider: ModelProvider = {
      plan() {
        return Promise.resolve({ complexity: 'low', steps: [] })
      },
      execute() {
        return Promise.resolve('')
      },
      decideNextAction() {
        decisions += 1
        return Promise.resolve({ kind: 'final' as const })
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: await Promise.resolve('react answer') }
      }
    }

    const events = await collectEvents(createChatRuntime({ provider, agentType: 'react' }))

    expect(decisions).toBe(1)
    expect(events.find((event) => event.type === 'agent.run.started')).toMatchObject({
      payload: { agentType: 'react' }
    })
    expect(events.at(-1)).toMatchObject({ type: 'assistant.done', payload: { source: 'react answer' } })
  })

  it('defaults to the Plan-then-Execute runtime', async () => {
    const provider: ModelProvider = {
      plan() {
        return Promise.resolve({ complexity: 'low', steps: [] })
      },
      execute() {
        return Promise.resolve('')
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: await Promise.resolve('plan answer') }
      }
    }

    const events = await collectEvents(createChatRuntime({ provider }))

    expect(events.find((event) => event.type === 'agent.run.started')).toMatchObject({
      payload: { agentType: 'plan-execute' }
    })
  })

  it('converts app-core rate-limit errors into runtime retries', async () => {
    const retryAt = new Date(Date.now() + 1).toISOString()
    let attempts = 0
    const provider: ModelProvider = {
      plan() {
        return Promise.resolve({ complexity: 'low', steps: [] })
      },
      execute() {
        return Promise.resolve('')
      },
      async *synthesize() {
        attempts += 1
        if (attempts === 1) {
          throw new RateLimitError('rate limited', { retryAfterMs: 1, retryAt })
        }
        yield { kind: 'content' as const, text: await Promise.resolve('retried') }
      }
    }

    const events = await collectEvents(createChatRuntime({ provider }))

    expect(attempts).toBe(2)
    expect(events.some((event) => event.type === 'rate.limit.waiting')).toBe(true)
    expect(events.some((event) => event.type === 'rate.limit.recovered')).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'assistant.done',
      payload: { source: 'retried' }
    })
  })

  it('notifies chat.event hooks for emitted runtime events', async () => {
    const observed: ChatEvent['type'][] = []
    const provider: ModelProvider = {
      plan() {
        return Promise.resolve({ complexity: 'low', steps: [] })
      },
      execute() {
        return Promise.resolve('')
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: await Promise.resolve('done') }
      }
    }

    const events = await collectEvents(
      createChatRuntime({
        provider,
        hooks: [
          {
            event: 'chat.event',
            handler: ({ event }) => {
              observed.push(event.type)
            }
          }
        ]
      })
    )

    expect(observed).toEqual(events.map((event) => event.type))
  })

  it('blocks tool execution when a before-tool hook denies it', async () => {
    let toolExecutions = 0
    const provider: ModelProvider = {
      plan() {
        return Promise.resolve({
          complexity: 'medium',
          steps: [
            {
              id: 'search',
              summary: 'Search for context',
              toolCall: {
                toolId: 'web-search',
                input: { query: 'latest news', maxResults: 5 }
              }
            }
          ]
        })
      },
      execute() {
        return Promise.resolve('continued after denial')
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: await Promise.resolve('done') }
      }
    }

    const events = await collectEvents(
      createChatRuntime({
        provider,
        tools: [
          {
            id: 'web-search',
            description: 'Search the web',
            schema: searchRequestSchema,
            execute() {
              toolExecutions += 1
              return Promise.resolve({ results: [] })
            }
          }
        ],
        hooks: [
          {
            event: 'tool.beforeExecute',
            handler: ({ toolId }) =>
              Promise.resolve({
                allow: false,
                reason: `Permission denied for ${toolId}`
              })
          }
        ]
      })
    )

    const startedIndex = events.findIndex(
      (event) => event.type === 'agent.tool.started'
    )
    const failedIndex = events.findIndex(
      (event) => event.type === 'agent.tool.failed'
    )
    const failed = events[failedIndex]

    expect(toolExecutions).toBe(0)
    expect(startedIndex).toBeGreaterThanOrEqual(0)
    expect(failedIndex).toBeGreaterThan(startedIndex)
    expect(failed).toMatchObject({
      type: 'agent.tool.failed',
      payload: {
        toolId: 'web-search',
        error: 'Tool execution blocked: Permission denied for web-search'
      }
    })
  })
})
