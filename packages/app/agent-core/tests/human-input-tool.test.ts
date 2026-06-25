import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { AgentRuntime } from '../src/runtime/agent-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { AgentHookContribution } from '../src/plugins/types'
import type { ModelProvider } from '../src/types'

// Issue #85 — a human-in-the-loop tool (`awaitsHumanInput`) is treated differently
// from a machine tool in two ways the runtime owns: (D1) it gets the human-input
// budget instead of the short machine `toolTimeoutMs`, and (D6) it is exempt from the
// `tool.beforeExecute` permission gate because it already asks the user. These tests
// drive a full plan-execute run whose single plan step calls the tool.

const askInput = { question: 'Pick one', options: ['a', 'b'], allowCustom: true }

// A provider whose plan is a single tool call to `toolId`, then a one-shot answer.
const planToolProvider = (toolId: string): ModelProvider => ({
  async plan() {
    return {
      complexity: 'low',
      steps: [{ id: 'ask', summary: 'Ask the user', toolCall: { toolId, input: askInput } }]
    }
  },
  async execute() {
    return 'ok'
  },
  async *synthesize() {
    yield { kind: 'content' as const, text: 'done' }
  }
})

const askSchema = z.object({
  question: z.string(),
  options: z.array(z.string()),
  allowCustom: z.boolean()
})

const run = async (runtime: AgentRuntime): Promise<ChatEvent[]> => {
  const events: ChatEvent[] = []
  for await (const event of runtime.run('hello')) {
    events.push(event)
  }
  return events
}

const denyGate: AgentHookContribution = {
  event: 'tool.beforeExecute',
  handler: () => ({ allow: false, reason: 'Denied by user' })
}

const completedFor = (events: ChatEvent[], toolId: string): boolean =>
  events.some((e) => e.type === 'agent.tool.completed' && e.payload.toolId === toolId)
const failedFor = (events: ChatEvent[], toolId: string): boolean =>
  events.some((e) => e.type === 'agent.tool.failed' && e.payload.toolId === toolId)

describe('awaitsHumanInput tools', () => {
  it('(D1) holds a human-input tool to the human budget, not the 10s machine timeout', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'ask_user',
      description: 'asks the user',
      schema: askSchema,
      awaitsHumanInput: true,
      async execute() {
        // Resolves well after the tiny machine timeout but inside the human budget.
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { kind: 'option', value: 'a' }
      }
    })

    // toolTimeoutMs:1 would fail a normal tool; humanInputTimeoutMs:1000 saves this one.
    const runtime = new AgentRuntime(planToolProvider('ask_user'), registry, {
      toolTimeoutMs: 1,
      humanInputTimeoutMs: 1000
    })
    const events = await run(runtime)

    expect(completedFor(events, 'ask_user')).toBe(true)
    expect(failedFor(events, 'ask_user')).toBe(false)
  })

  it('a normal (non-human) tool still times out at the machine budget', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'slow',
      description: 'slow machine tool',
      schema: askSchema,
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { kind: 'option', value: 'a' }
      }
    })

    const runtime = new AgentRuntime(planToolProvider('slow'), registry, {
      toolTimeoutMs: 1,
      humanInputTimeoutMs: 1000
    })
    const events = await run(runtime)

    expect(failedFor(events, 'slow')).toBe(true)
  })

  it('(D6) exempts a human-input tool from a denying permission gate', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'ask_user',
      description: 'asks the user',
      schema: askSchema,
      awaitsHumanInput: true,
      async execute() {
        return { kind: 'option', value: 'a' }
      }
    })

    const runtime = new AgentRuntime(planToolProvider('ask_user'), registry, { hooks: [denyGate] })
    const events = await run(runtime)

    expect(completedFor(events, 'ask_user')).toBe(true)
    expect(failedFor(events, 'ask_user')).toBe(false)
  })

  it('still gates a normal tool through the permission gate', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'web-search',
      description: 'machine tool',
      schema: askSchema,
      async execute() {
        return { kind: 'option', value: 'a' }
      }
    })

    const runtime = new AgentRuntime(planToolProvider('web-search'), registry, { hooks: [denyGate] })
    const events = await run(runtime)

    expect(completedFor(events, 'web-search')).toBe(false)
    const failure = events.find(
      (e) => e.type === 'agent.tool.failed' && e.payload.toolId === 'web-search'
    )
    expect(failure?.type === 'agent.tool.failed' && failure.payload.error).toContain(
      'Tool execution blocked'
    )
  })
})
