import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { AgentRuntime } from '../src/runtime/agent-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { AgentHookContribution } from '../src/plugins/types'
import type { ModelProvider } from '../src/types'

// Issue #85 — a human-in-the-loop tool (`awaitsHumanInput`). The RUNTIME owns exactly
// one behaviour: (D1) the tool's execution gets the human-input budget instead of the
// short machine `toolTimeoutMs`. The gate EXEMPTION (D6) is NOT a runtime skip — the
// runtime surfaces the flag on `ToolExecutionContext.awaitsHumanInput` and always runs
// the gate chain; a gate (the permissions gate, tested in plugin-permissions) reads the
// flag to self-exempt, while a gate that ignores it still blocks. These tests drive a
// full plan-execute run whose single plan step calls the tool.

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

// A gate that denies every tool unconditionally — it does NOT consult the
// context flag. Used to prove the runtime no longer blanket-skips the gate chain
// for human-input tools: such a gate still blocks them.
const denyGate: AgentHookContribution = {
  event: 'tool.beforeExecute',
  handler: () => ({ allow: false, reason: 'Denied by user' })
}

// A gate that mimics the permissions gate's self-exemption: it allows a tool that
// declares itself human-input (via the runtime-propagated `context.awaitsHumanInput`)
// and denies everything else. Proves the runtime surfaces the flag on the context and
// that a GATE — not the runtime — owns the exemption.
const selfExemptGate: AgentHookContribution = {
  event: 'tool.beforeExecute',
  handler: (context) =>
    context.awaitsHumanInput ? { allow: true } : { allow: false, reason: 'Denied by user' }
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

  it('(D6) a gate self-exempts a human-input tool via context.awaitsHumanInput', async () => {
    // The runtime surfaces the tool's flag on ToolExecutionContext; the gate reads it
    // and allows. A normal tool through the SAME gate is blocked — the exemption is the
    // gate's decision keyed on the context flag, not a runtime skip.
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

    const runtime = new AgentRuntime(planToolProvider('ask_user'), registry, {
      hooks: [selfExemptGate]
    })
    const events = await run(runtime)

    expect(completedFor(events, 'ask_user')).toBe(true)
    expect(failedFor(events, 'ask_user')).toBe(false)
  })

  it('runs the gate chain for a human-input tool: a gate that ignores the flag still blocks it', async () => {
    // The runtime no longer blanket-skips the gate chain for human-input tools — only a
    // gate that opts to exempt (like the permissions gate) does. A generic deny gate that
    // does not consult the flag therefore still blocks even a human-input tool.
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

    expect(completedFor(events, 'ask_user')).toBe(false)
    expect(failedFor(events, 'ask_user')).toBe(true)
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

    const runtime = new AgentRuntime(planToolProvider('web-search'), registry, {
      hooks: [denyGate]
    })
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
