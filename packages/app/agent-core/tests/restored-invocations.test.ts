import type { ChatEvent } from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import { HybridRuntime } from '../src/runtime/hybrid-runtime'
import { ReActRuntime } from '../src/runtime/react-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { ExecutionContext, ModelProvider, ToolInvocation } from '../src/types'

// Issue #531: an explicit Resume hands ReAct the calls the run already made.
// They are observations only — never re-executed — and the run itself starts
// fresh: new context, new step budget, new monotonic cooldown anchor.

const restored: ToolInvocation[] = [
  {
    callId: 'call-1',
    toolId: 'mcp:srv:create',
    input: { name: 'demo' },
    outcome: { ok: true, output: { id: 'opaque' } },
    source: { kind: 'mcp', groupId: 'srv' }
  }
]

const provider = (seen: ExecutionContext[]): ModelProvider => ({
  plan: () => Promise.resolve({ complexity: 'low', steps: [{ id: 's1', summary: 'step' }] }),
  execute: () => Promise.resolve(''),
  decideNextAction(context) {
    seen.push({ ...context, toolInvocations: [...context.toolInvocations] })
    return Promise.resolve({ kind: 'final' })
  },
  async *synthesize() {
    await Promise.resolve()
    yield { kind: 'content', text: 'ok' }
  }
})

const drain = async (events: AsyncGenerator<ChatEvent>) => {
  const all: ChatEvent[] = []
  for await (const event of events) all.push(event)
  return all
}

describe('restoredInvocations (issue #531)', () => {
  it('seeds a fresh ReAct context with the saved calls without running them', async () => {
    const seen: ExecutionContext[] = []
    const registry = new ToolRegistry()
    const before = performance.now()
    await drain(
      new ReActRuntime(provider(seen), registry).run('go', { restoredInvocations: restored })
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]!.toolInvocations).toEqual(restored)
    expect(seen[0]!.runStartedAt).toBeGreaterThanOrEqual(before)
    // The caller's array is copied, not adopted.
    expect(restored).toHaveLength(1)
  })

  it('is ignored by strategies that cannot resume', async () => {
    const seen: ExecutionContext[] = []
    await drain(
      new HybridRuntime(provider(seen), new ToolRegistry()).run('go', {
        restoredInvocations: restored
      })
    )
    expect(seen.every((context) => context.toolInvocations.length === 0)).toBe(true)
  })
})
