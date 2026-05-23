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
        yield await Promise.resolve('done')
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

    expect(events.some((event) => event.type === 'tool.call.started')).toBe(true)
    expect(events.some((event) => event.type === 'tool.call.completed')).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'assistant.done',
      payload: { text: 'done' }
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
        yield await Promise.resolve('retried')
      }
    }

    const events = await collectEvents(createChatRuntime({ provider }))

    expect(attempts).toBe(2)
    expect(events.some((event) => event.type === 'rate.limit.waiting')).toBe(true)
    expect(events.some((event) => event.type === 'rate.limit.recovered')).toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'assistant.done',
      payload: { text: 'retried' }
    })
  })
})
