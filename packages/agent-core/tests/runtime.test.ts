import { describe, expect, it } from 'vitest'
import { AgentRuntime } from '../src/runtime/agent-runtime'
import { ToolRegistry } from '../src/tools/registry'
import { z } from 'zod'
import type { ModelProvider } from '../src/types'

const provider: ModelProvider = {
  async plan() {
    return {
      complexity: 'low',
      steps: [
        {
          id: 'search',
          summary: 'Search web',
          toolCall: {
            toolId: 'web-search',
            input: { query: 'hello' }
          }
        }
      ]
    }
  },
  async execute() {
    return 'ok'
  },
  async *synthesize() {
    yield 'hi '
    yield 'there'
  }
}

describe('AgentRuntime', () => {
  it('emits core planning, execution and assistant events', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'web-search',
      description: 'test tool',
      schema: z.object({ query: z.string() }),
      async execute() {
        return { count: 1 }
      }
    })

    const runtime = new AgentRuntime(provider, registry)
    const events = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'plan.generated')).toBe(true)
    expect(events.some((event) => event.type === 'tool.call.completed')).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('emits tool failure when tool exceeds timeout', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'web-search',
      description: 'slow tool',
      schema: z.object({ query: z.string() }),
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { count: 1 }
      }
    })

    const runtime = new AgentRuntime(provider, registry, { toolTimeoutMs: 1 })
    const events = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'tool.call.failed')).toBe(true)
  })
})
