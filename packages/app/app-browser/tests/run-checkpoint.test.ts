import { describe, expect, it } from 'vitest'
import { createEvent, type ChatRuntime } from '@tinytinkerer/app-core'
import type { AgentType, ChatEvent } from '@tinytinkerer/contracts'
import { withRunCheckpoint } from '../src/runtime/checkpointing-runtime'
import {
  assessCheckpoint,
  CHECKPOINT_TTL_MS,
  MAX_CHECKPOINT_CHARS,
  parseCheckpoint,
  type RunCheckpoint,
  type RunCheckpointStore
} from '../src/runtime/run-checkpoint'

// Issue #531: the checkpoint's own rules, without a network. The decorator is
// driven by a scripted inner runtime that emits exactly the events the real
// runtimes do around a tool call.

const memoryStore = () => {
  const rows = new Map<string, unknown>()
  const ownerOf = (id: string) => (rows.get(id) as { owner?: string } | undefined)?.owner
  const store: RunCheckpointStore = {
    get: (id) => Promise.resolve(structuredClone(rows.get(id))),
    swap: (record, expected) => {
      if (ownerOf(record.conversationId) !== expected) return Promise.resolve(false)
      rows.set(record.conversationId, structuredClone(record))
      return Promise.resolve(true)
    },
    delete: (id, expected) => {
      if (expected !== undefined && rows.has(id) && ownerOf(id) !== expected) {
        return Promise.resolve(false)
      }
      rows.delete(id)
      return Promise.resolve(true)
    }
  }
  return { rows, store }
}

const scripted = (agentType: AgentType, output: unknown, fail = true): ChatRuntime => ({
  async *run(prompt) {
    await Promise.resolve()
    yield createEvent('user.message', { text: prompt })
    yield createEvent('agent.run.started', { agentType })
    const source = { kind: 'mcp' as const, groupId: 'srv' }
    yield createEvent('agent.tool.started', {
      stepId: 't1',
      toolId: 'mcp:srv:big',
      input: {},
      source
    })
    yield createEvent('agent.tool.completed', {
      stepId: 't1',
      toolId: 'mcp:srv:big',
      output,
      source
    })
    if (fail) yield createEvent('error', { message: 'ReAct decision timed out' })
    yield createEvent('assistant.done', {
      source: 'I hit an execution issue. Please try again.',
      content: { nodes: [] }
    })
  }
})

const decorate = (inner: ChatRuntime, store: RunCheckpointStore) =>
  withRunCheckpoint(inner, {
    store: () => Promise.resolve(store),
    conversationId: 'c1',
    account: () => Promise.resolve('anonymous'),
    origins: () => Promise.resolve({ srv: 'origin' }),
    tools: new Map([['mcp:srv:big', { kind: 'mcp', groupId: 'srv' }]]),
    createSession: () =>
      Promise.resolve({
        replace: (source: string) => ({ source, content: { nodes: [] } })
      })
  })

const drain = async (events: AsyncGenerator<ChatEvent>) => {
  const all: ChatEvent[] = []
  for await (const event of events) all.push(event)
  return all
}
const answer = (events: ChatEvent[]) =>
  events.flatMap((event) => (event.type === 'assistant.done' ? [event.payload.source] : [])).at(-1)

const checkpoint = (overrides: Partial<RunCheckpoint> = {}): RunCheckpoint => ({
  version: 1,
  conversationId: 'c1',
  turnId: 'u1',
  prompt: 'p',
  history: [],
  agentType: 'react',
  account: 'anonymous',
  origins: { srv: 'origin' },
  invocations: [
    {
      callId: 't1',
      toolId: 'mcp:srv:big',
      input: {},
      outcome: { ok: true, output: 1 },
      source: { kind: 'mcp', groupId: 'srv' }
    }
  ],
  state: 'stopped',
  attempts: 1,
  owner: 'o1',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides
})
const env = {
  conversationId: 'c1',
  turnId: 'u1',
  account: 'anonymous',
  origins: { srv: 'origin' },
  tools: new Map([['mcp:srv:big', { kind: 'mcp' as const, groupId: 'srv' }]]),
  now: Date.now()
}

describe('run checkpoint rules (issue #531)', () => {
  it('accepts a valid record and refuses each kind of mismatch truthfully', () => {
    expect(assessCheckpoint(checkpoint(), env)).toBeUndefined()
    expect(assessCheckpoint(checkpoint({ turnId: 'u0' }), env)?.reason).toContain('earlier turn')
    const hybrid = assessCheckpoint(checkpoint({ agentType: 'hybrid' }), env)
    expect(hybrid?.retryable).toBe(false)
    expect(hybrid?.reason).toContain('ReAct runs only')
    expect(
      assessCheckpoint(checkpoint(), { ...env, now: Date.now() + CHECKPOINT_TTL_MS + 1 })?.reason
    ).toContain('expired')
    const unsourced = checkpoint()
    delete unsourced.invocations[0]!.source
    // Provenance is never invented, even though the tool still has a source.
    expect(assessCheckpoint(unsourced, env)?.reason).toContain('no recorded origin')
  })

  it('treats anything but a version-1 record as incompatible', () => {
    expect(parseCheckpoint(undefined)).toBeUndefined()
    expect(parseCheckpoint({ ...checkpoint(), version: 2 })).toMatchObject({ ok: false })
    expect(parseCheckpoint({ ...checkpoint(), invocations: [{ toolId: 1 }] })).toMatchObject({
      ok: false
    })
    expect(parseCheckpoint(checkpoint())).toMatchObject({ ok: true })
  })

  it('records an oversized run as not resumable instead of truncating its results', async () => {
    const { rows, store } = memoryStore()
    const events = await drain(
      decorate(scripted('react', 'x'.repeat(MAX_CHECKPOINT_CHARS)), store).run('p')
    )
    const saved = rows.get('c1') as RunCheckpoint
    expect(saved.invocations).toEqual([])
    expect(saved.blocked).toEqual({
      reason: "This run's results are too large to save for Resume.",
      retryable: false
    })
    expect(answer(events)).toContain('too large to save for Resume')
    // The in-memory run still reports what completed.
    expect(answer(events)).toContain('`mcp:srv:big` — returned a result')
  })

  it('stores nothing for a strategy that cannot resume, and says so', async () => {
    const { rows, store } = memoryStore()
    const events = await drain(decorate(scripted('plan-execute', { ok: 1 }), store).run('p'))
    expect(rows.size).toBe(0)
    expect(answer(events)).toContain('Resume is not available for the plan-execute agent')
  })

  it('deletes saved progress when the run completes, and keeps the generic path without tool work', async () => {
    const { rows, store } = memoryStore()
    const completing: ChatRuntime = {
      async *run(prompt) {
        yield* scripted('react', 1, false).run(prompt)
      }
    }
    // A completed ReAct run ends with a final decision.
    const withFinal: ChatRuntime = {
      async *run(prompt) {
        for await (const event of completing.run(prompt)) {
          if (event.type === 'assistant.done') {
            yield createEvent('agent.step.completed', { stepId: 'd', decisionKind: 'final' })
          }
          yield event
        }
      }
    }
    await drain(decorate(withFinal, store).run('p'))
    expect(rows.size).toBe(0)

    const noTools: ChatRuntime = {
      async *run(prompt) {
        await Promise.resolve()
        yield createEvent('user.message', { text: prompt })
        yield createEvent('agent.run.started', { agentType: 'react' })
        yield createEvent('error', { message: 'boom' })
        yield createEvent('assistant.done', {
          source: 'I hit an execution issue. Please try again.',
          content: { nodes: [] }
        })
      }
    }
    const events = await drain(decorate(noTools, store).run('p'))
    expect(rows.size).toBe(0)
    expect(answer(events)).toBe('I hit an execution issue. Please try again.')
  })
})
