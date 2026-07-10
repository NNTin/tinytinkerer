/* eslint-disable @typescript-eslint/require-await -- the ModelProvider test
doubles below implement an async interface (plan/execute/decideNextAction/
synthesize) without needing to await internally; agent-core's package lint
scopes to `src`, but husky lints staged test files, so this interface-noise
rule is disabled for this file (mirrors serialize-tool-note-media.test.ts). */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ChatEvent, ReActDecision } from '@tinytinkerer/contracts'
import { ReActRuntime } from '../src/runtime/react-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { AgentRuntimeOptions } from '../src/runtime/agent-runtime-base'
import type { ModelProvider } from '../src/types'

// Minimal scripted ModelProvider: replays a fixed decision list, then finishes.
// Mirrors the fixture in serialize-tool-note-media.test.ts.
const scriptedProvider = (decisions: ReActDecision[]): ModelProvider => {
  let index = 0
  return {
    async plan() {
      return { complexity: 'low', steps: [] }
    },
    async execute() {
      return ''
    },
    async decideNextAction() {
      const decision = decisions[Math.min(index, decisions.length - 1)]
      index += 1
      return decision ?? { kind: 'final' }
    },
    async *synthesize() {
      yield { kind: 'content' as const, text: 'answer' }
    }
  }
}

const runToFailedKind = async (
  registry: ToolRegistry,
  runtimeOptions: AgentRuntimeOptions = {}
): Promise<string | undefined> => {
  const provider = scriptedProvider([
    { kind: 'action', toolId: 'flaky', input: {} },
    { kind: 'final' }
  ])
  const runtime = new ReActRuntime(provider, registry, runtimeOptions)
  const events: ChatEvent[] = []
  for await (const event of runtime.run('hello')) {
    events.push(event)
  }
  for (const event of events) {
    if (event.type === 'agent.tool.failed') {
      return event.payload.kind
    }
  }
  return undefined
}

describe('agent.tool.failed kind taxonomy', () => {
  it('a tool that throws is reported as kind "execution"', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'flaky',
      description: 'always throws',
      schema: z.object({}),
      async execute() {
        throw new Error('boom')
      }
    })

    expect(await runToFailedKind(registry)).toBe('execution')
  })

  it('a tool that exceeds its timeout budget is reported as kind "timeout"', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'flaky',
      description: 'never resolves',
      schema: z.object({}),
      execute: () => new Promise(() => {})
    })

    expect(await runToFailedKind(registry, { toolTimeoutMs: 5 })).toBe('timeout')
  })

  it('a tool.beforeExecute gate denial is reported as kind "blocked"', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'flaky',
      description: 'never reached — the gate denies first',
      schema: z.object({}),
      async execute() {
        return 'unreached'
      }
    })

    const kind = await runToFailedKind(registry, {
      hooks: [
        {
          event: 'tool.beforeExecute',
          handler: () => ({ allow: false, reason: 'denied by test gate' })
        }
      ]
    })

    expect(kind).toBe('blocked')
  })

  it('tool calls disabled by runtime policy (maxToolCallsPerStep: 0) is reported as kind "blocked"', async () => {
    const registry = new ToolRegistry()
    registry.register({
      id: 'flaky',
      description: 'never reached — policy disables tool calls',
      schema: z.object({}),
      async execute() {
        return 'unreached'
      }
    })

    expect(await runToFailedKind(registry, { maxToolCallsPerStep: 0 })).toBe('blocked')
  })
})
