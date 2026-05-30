import type { ChatEvent } from '@tinytinkerer/contracts'
import { createEvent } from '../events/create-event'
import type { ExecutionContext } from '../types'
import { AgentRuntimeBase, createStepId, type RunOptions } from './agent-runtime-base'
import { withTimeout } from './utils'

const DEFAULT_MAX_SUB_ITERATIONS = 3
const DEFAULT_MAX_REPLANS = 1

// Hybrid (Plan + ReAct): build an upfront plan, then accomplish each plan step
// with a bounded ReAct sub-loop that can adapt locally. If a step gets stuck
// (its sub-loop exhausts its budget without finishing), the agent replans once
// and continues. Combines the long-horizon focus of a plan with the local
// adaptability of ReAct.
export class HybridRuntime extends AgentRuntimeBase {
  private readonly maxSubIterations = DEFAULT_MAX_SUB_ITERATIONS
  private readonly maxReplans = DEFAULT_MAX_REPLANS

  async *run(prompt: string, options: RunOptions = {}): AsyncGenerator<ChatEvent> {
    const { signal } = options
    const context: ExecutionContext = this.createContext(prompt, options.history ?? [])

    yield createEvent('user.message', { text: prompt })
    yield createEvent('agent.run.started', { agentType: 'hybrid' })

    const callOptions = { ...(signal ? { signal } : {}), searchEnabled: this.searchEnabled }

    try {
      let plan = await withTimeout(
        this.provider.plan(prompt, context.history, callOptions),
        this.stepTimeoutMs,
        'Planner timed out'
      )
      context.plan = plan

      const planStepId = createStepId()
      yield createEvent('agent.step.started', {
        stepId: planStepId,
        kind: 'plan',
        title: `Created ${plan.steps.length}-step plan`
      })
      yield createEvent('agent.step.completed', { stepId: planStepId })

      let total = 0
      let replans = 0
      let completedSteps = 0
      let queue = plan.steps.slice(0, this.maxIterations)
      let index = 0

      while (index < queue.length && total < this.maxIterations) {
        if (signal?.aborted) {
          break
        }

        const step = queue[index]
        index += 1
        if (!step) {
          continue
        }

        const stepEventId = createStepId()
        yield createEvent('agent.step.started', {
          stepId: stepEventId,
          parentStepId: planStepId,
          kind: 'plan-step',
          title: step.summary
        })

        const budget = Math.min(this.maxSubIterations, this.maxIterations - total)
        const sub = yield* this.runReActLoop(context, {
          budget,
          searchEnabled: this.searchEnabled,
          parentStepId: stepEventId,
          ...(signal ? { signal } : {})
        })
        total += sub.iterations

        // A step that never reached a final decision is "stuck": replan once and
        // restart from the revised plan. Otherwise mark the step done.
        if (!sub.reachedFinal && replans < this.maxReplans && !signal?.aborted) {
          replans += 1
          const replanStepId = createStepId()
          yield createEvent('agent.step.started', {
            stepId: replanStepId,
            kind: 'replan',
            title: 'Revising plan'
          })
          plan = await withTimeout(
            this.provider.plan(prompt, context.history, callOptions),
            this.stepTimeoutMs,
            'Planner timed out'
          )
          context.plan = plan
          yield createEvent('agent.step.completed', { stepId: replanStepId })
          yield createEvent('agent.step.completed', {
            stepId: stepEventId,
            ...(sub.note ? { summary: sub.note } : {})
          })
          completedSteps += 1
          queue = plan.steps.slice(0, Math.max(0, this.maxIterations - total))
          index = 0
          continue
        }

        yield createEvent('agent.step.completed', {
          stepId: stepEventId,
          ...(sub.note ? { summary: sub.note } : {})
        })
        completedSteps += 1
      }

      yield createEvent('agent.run.completed', { steps: completedSteps })

      if (signal?.aborted) {
        yield createEvent('assistant.done', (await this.createAssistantContentSession()).snapshot())
        return
      }

      yield* this.synthesizeWithRateLimit(context, signal)
    } catch (error) {
      yield* this.handleRunError(error)
    }
  }
}
