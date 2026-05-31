import type { ChatEvent, ExecutionPlan, ReActDecision } from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RateLimitError } from '../src/errors/rate-limit-error'
import { HybridRuntime } from '../src/runtime/hybrid-runtime'
import { ToolRegistry } from '../src/tools/registry'
import type { ModelProvider } from '../src/types'

type EventOf<TType extends ChatEvent['type']> = Extract<ChatEvent, { type: TType }>
const isEventType =
  <TType extends ChatEvent['type']>(type: TType) =>
  (event: ChatEvent): event is EventOf<TType> =>
    event.type === type

const noopRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry()
  registry.register({
    id: 'noop',
    description: 'test tool',
    schema: z.object({}).passthrough(),
    async execute() {
      return { ok: true }
    }
  })
  return registry
}

// Provider with scripted plans (one per plan() call) and a decision function.
const hybridProvider = (
  plans: ExecutionPlan[],
  decide: () => ReActDecision
): { provider: ModelProvider; planCalls: () => number } => {
  let planIndex = 0
  const provider: ModelProvider = {
    async plan() {
      const plan = plans[Math.min(planIndex, plans.length - 1)]
      planIndex += 1
      return plan ?? { complexity: 'low', steps: [] }
    },
    async execute() {
      return ''
    },
    async decideNextAction() {
      return decide()
    },
    async *synthesize() {
      yield { kind: 'content' as const, text: 'final answer' }
    }
  }
  return { provider, planCalls: () => planIndex }
}

describe('HybridRuntime', () => {
  it('plans upfront and runs a ReAct sub-loop per step', async () => {
    const { provider } = hybridProvider(
      [
        {
          complexity: 'medium',
          steps: [
            { id: 's1', summary: 'First step' },
            { id: 's2', summary: 'Second step' }
          ]
        }
      ],
      () => ({ kind: 'final' })
    )

    const runtime = new HybridRuntime(provider, noopRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(events.find(isEventType('agent.run.started'))?.payload.agentType).toBe('hybrid')
    const stepKinds = events
      .filter(isEventType('agent.step.started'))
      .map((event) => event.payload.kind)
    expect(stepKinds).toContain('plan')
    expect(stepKinds.filter((kind) => kind === 'plan-step')).toHaveLength(2)
    // Nested think steps carry their plan-step parent.
    const thinkSteps = events
      .filter(isEventType('agent.step.started'))
      .filter((event) => event.payload.kind === 'think')
    expect(thinkSteps.length).toBeGreaterThan(0)
    expect(thinkSteps.every((event) => event.payload.parentStepId !== undefined)).toBe(true)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('replans once when a step gets stuck without finishing', async () => {
    const { provider, planCalls } = hybridProvider(
      [
        { complexity: 'high', steps: [{ id: 's1', summary: 'Stuck step' }] },
        { complexity: 'low', steps: [] }
      ],
      // Never returns final -> the sub-loop exhausts its budget -> replan.
      () => ({ kind: 'action', toolId: 'noop', input: {} })
    )

    const runtime = new HybridRuntime(provider, noopRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(planCalls()).toBe(2)
    const replanSteps = events
      .filter(isEventType('agent.step.started'))
      .filter((event) => event.payload.kind === 'replan')
    expect(replanSteps).toHaveLength(1)

    // The stuck plan-step is surfaced as failed (it exhausted its budget), not
    // completed, so progress is not overstated.
    const planStepStart = events
      .filter(isEventType('agent.step.started'))
      .find((event) => event.payload.kind === 'plan-step')
    expect(planStepStart).toBeDefined()
    const planStepId = planStepStart?.payload.stepId
    expect(
      events.some((event) => event.type === 'agent.step.failed' && event.payload.stepId === planStepId)
    ).toBe(true)
    expect(
      events.some((event) => event.type === 'agent.step.completed' && event.payload.stepId === planStepId)
    ).toBe(false)

    // The revised plan has no steps, so no step completes: the run summary
    // reflects zero completed steps rather than counting the abandoned one.
    const runCompleted = events.find(isEventType('agent.run.completed'))
    expect(runCompleted?.payload.steps).toBe(0)
    expect(events.at(-1)?.type).toBe('assistant.done')
  })

  it('never exceeds the total iteration cap', async () => {
    const { provider } = hybridProvider(
      [{ complexity: 'high', steps: [{ id: 's1', summary: 'Looping step' }] }],
      () => ({ kind: 'action', toolId: 'noop', input: {} })
    )

    const runtime = new HybridRuntime(provider, noopRegistry(), { maxIterations: 2 })
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    const toolStarts = events.filter((event) => event.type === 'agent.tool.started')
    expect(toolStarts.length).toBeLessThanOrEqual(2)
    expect(events.some((event) => event.type === 'agent.run.completed')).toBe(true)
  })

  it('does not count a plan step as completed when a decision cooldown is too long', async () => {
    const retryAt = new Date(Date.now() + 10 * 60_000).toISOString()
    const provider: ModelProvider = {
      async plan() {
        return {
          complexity: 'medium',
          steps: [{ id: 's1', summary: 'Blocked step' }]
        }
      },
      async execute() {
        return ''
      },
      async decideNextAction() {
        throw new RateLimitError('rate limited', { retryAfterMs: 10 * 60_000, retryAt })
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'composed anyway' }
      }
    }

    const runtime = new HybridRuntime(provider, noopRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    const planStepStart = events
      .filter(isEventType('agent.step.started'))
      .find((event) => event.payload.kind === 'plan-step')
    expect(planStepStart).toBeDefined()
    const planStepId = planStepStart?.payload.stepId

    expect(
      events.some(
        (event) =>
          event.type === 'rate.limit.cancelled' &&
          event.payload.reason === 'too_long' &&
          event.payload.retryAt === retryAt
      )
    ).toBe(true)
    expect(
      events.some((event) => event.type === 'agent.step.failed' && event.payload.stepId === planStepId)
    ).toBe(true)
    expect(
      events.some((event) => event.type === 'agent.step.completed' && event.payload.stepId === planStepId)
    ).toBe(false)
    expect(
      events.some((event) => event.type === 'agent.step.started' && event.payload.kind === 'replan')
    ).toBe(false)
    expect(events.find(isEventType('agent.run.completed'))?.payload.steps).toBe(0)
    expect(events.find(isEventType('assistant.done'))?.payload.source).toBe('composed anyway')
  })

  it('stops cleanly when the signal is aborted', async () => {
    const controller = new AbortController()
    const provider: ModelProvider = {
      async plan() {
        return {
          complexity: 'medium',
          steps: [
            { id: 's1', summary: 'First' },
            { id: 's2', summary: 'Second' }
          ]
        }
      },
      async execute() {
        return ''
      },
      async decideNextAction() {
        controller.abort()
        return { kind: 'final' }
      },
      async *synthesize() {
        yield { kind: 'content' as const, text: 'should not reach' }
      }
    }

    const runtime = new HybridRuntime(provider, noopRegistry())
    const events: ChatEvent[] = []
    for await (const event of runtime.run('hello', { signal: controller.signal })) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'agent.run.completed')).toBe(true)
    expect(events.some((event) => event.type === 'error')).toBe(false)
    const done = events.at(-1)
    expect(done?.type).toBe('assistant.done')
    expect(done?.type === 'assistant.done' && done.payload.source).toBe('')
  })
})
