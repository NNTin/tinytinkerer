import type { ChatEvent } from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DEFAULT_MAX_ITERATIONS } from '../src/runtime/agent-runtime-base'
import { ReActRuntime } from '../src/runtime/react-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { ModelProvider } from '../src/types'

// The per-turn step bound (issue #510, T4) is normalized once, in
// AgentRuntimeBase, so every agent type gets the same rule: below 1 is raised
// to 1, a fraction is floored, and a non-finite value means the default.

// A provider that always asks for another tool call, so the bound alone ends
// the turn.
const neverFinishes: ModelProvider = {
  plan: () => Promise.resolve({ complexity: 'low', steps: [] }),
  execute: () => Promise.resolve(''),
  decideNextAction: () =>
    Promise.resolve({ kind: 'action', toolId: 'probe', input: { query: 'again' } }),
  async *synthesize() {
    await Promise.resolve()
    yield { kind: 'content' as const, text: 'answered' }
  }
}

const registry = (): ToolRegistry => {
  const tools = new ToolRegistry()
  tools.register({
    id: 'probe',
    description: 'test tool',
    schema: z.object({ query: z.string() }),
    execute: () => Promise.resolve({ ok: true })
  })
  return tools
}

const runWith = async (maxIterations: number) => {
  const runtime = new ReActRuntime(neverFinishes, registry(), { maxIterations })
  const events: ChatEvent[] = []
  for await (const event of runtime.run('hello')) {
    events.push(event)
  }
  return {
    toolCalls: events.filter((event) => event.type === 'agent.tool.started').length,
    answered: events.some(
      (event) =>
        event.type === 'assistant.done' &&
        (event.payload as { source?: string }).source === 'answered'
    )
  }
}

describe('maxIterations normalization', () => {
  it('makes exactly maxIterations tool calls when the model never stops on its own', async () => {
    expect(await runWith(4)).toEqual({ toolCalls: 4, answered: true })
  })

  it('raises a bound below 1 to one decision, and the turn still answers', async () => {
    expect(await runWith(0)).toEqual({ toolCalls: 1, answered: true })
    expect(await runWith(-3)).toEqual({ toolCalls: 1, answered: true })
  })

  it('floors a fractional bound', async () => {
    expect(await runWith(2.7)).toEqual({ toolCalls: 2, answered: true })
  })

  it('treats a non-finite bound as the default, not as unbounded', async () => {
    expect(await runWith(Number.NaN)).toEqual({
      toolCalls: DEFAULT_MAX_ITERATIONS,
      answered: true
    })
    expect(await runWith(Number.POSITIVE_INFINITY)).toEqual({
      toolCalls: DEFAULT_MAX_ITERATIONS,
      answered: true
    })
  })
})
