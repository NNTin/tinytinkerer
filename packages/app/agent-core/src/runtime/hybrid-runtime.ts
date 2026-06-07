import type { ChatEvent } from '@tinytinkerer/contracts'
import { createEvent } from '../events/create-event'
import type { ExecutionContext } from '../types'
import { AgentRuntimeBase, createStepId, type RunOptions } from './agent-runtime-base'
import { withTimeout } from './utils'

const DEFAULT_MAX_SUB_ITERATIONS = 3
const DEFAULT_MAX_REPLANS = 1

// Builds the prompt for a replan. plan() only takes a prompt and history, so the
// work done so far (observations and tool results) is folded into the prompt
// text; this is what lets the planner build on progress instead of regenerating
// the same plan after a step gets stuck. Falls back to the original prompt when
// nothing has been gathered yet.
const buildReplanPrompt = (prompt: string, context: ExecutionContext): string => {
  const observations = context.notes.filter(Boolean)
  const toolResults = Object.entries(context.toolResults)
  if (observations.length === 0 && toolResults.length === 0) {
    return prompt
  }

  const sections = [
    prompt,
    '',
    'The previous plan got stuck. Revise the plan to build on the work already done below; avoid repeating steps that are already covered.'
  ]
  if (observations.length > 0) {
    sections.push('', 'Observations so far:', ...observations)
  }
  if (toolResults.length > 0) {
    sections.push('', 'Tool results:', ...toolResults.map(([key, value]) => `${key}: ${JSON.stringify(value)}`))
  }
  return sections.join('\n')
}

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
      // The planner is a single-shot model call, so it gets the generous
      // whole-response budget rather than the inter-chunk idle gap that tripped
      // "Planner timed out" on slow reasoning models (FRONTEND-S).
      let plan = await withTimeout(
        this.provider.plan(prompt, context.history, callOptions),
        this.firstChunkTimeoutMs,
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

        if (sub.exitReason === 'final') {
          yield createEvent('agent.step.completed', {
            stepId: stepEventId,
            ...(sub.note ? { summary: sub.note } : {})
          })
          completedSteps += 1
          continue
        }

        if (sub.exitReason === 'budget_exhausted') {
          // The step exhausted its sub-loop budget without finishing — it is
          // "stuck". Surface it as failed (not completed) and do not count it,
          // so the activity timeline and agent.run.completed.steps don't
          // overstate progress.
          yield createEvent('agent.step.failed', {
            stepId: stepEventId,
            error: sub.note
              ? `Step abandoned after exhausting its budget. Last observation: ${sub.note}`
              : 'Step abandoned after exhausting its budget'
          })

          // Replan once, informed by the work done so far, and restart from the
          // revised plan. When the replan budget is spent (or the run was
          // aborted) fall through and let the loop advance to the next queued
          // step.
          if (replans < this.maxReplans && !signal?.aborted) {
            replans += 1
            const replanStepId = createStepId()
            yield createEvent('agent.step.started', {
              stepId: replanStepId,
              kind: 'replan',
              title: 'Revising plan'
            })
            plan = await withTimeout(
              this.provider.plan(buildReplanPrompt(prompt, context), context.history, callOptions),
              this.firstChunkTimeoutMs,
              'Planner timed out'
            )
            context.plan = plan
            yield createEvent('agent.step.completed', { stepId: replanStepId })
            queue = plan.steps.slice(0, Math.max(0, this.maxIterations - total))
            index = 0
          }
          continue
        }

        yield createEvent('agent.step.failed', {
          stepId: stepEventId,
          error:
            sub.exitReason === 'aborted'
              ? 'Step cancelled'
              : 'Step interrupted before completion'
        })
        break
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
