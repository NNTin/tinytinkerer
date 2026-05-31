import type { ChatEvent } from '@tinytinkerer/contracts'
import { createEvent } from '../events/create-event'
import type { ExecutionContext } from '../types'
import { AgentRuntimeBase, createStepId, type RunOptions } from './agent-runtime-base'
import { withTimeout } from './utils'

// Plan-then-Execute: build the whole plan upfront, then execute each step in
// order (optionally calling a tool), and finally synthesize the answer. Shared
// machinery (tool execution, rate-limited synthesis) lives in AgentRuntimeBase;
// this class only orchestrates the plan/execute flow and emits the
// strategy-agnostic agent-trace events.
export class AgentRuntime extends AgentRuntimeBase {
  async *run(prompt: string, options: RunOptions = {}): AsyncGenerator<ChatEvent> {
    const { signal } = options
    const context: ExecutionContext = this.createContext(prompt, options.history ?? [])

    yield createEvent('user.message', { text: prompt })
    yield createEvent('agent.run.started', { agentType: 'plan-execute' })

    const callOptions = { ...(signal ? { signal } : {}), searchEnabled: this.searchEnabled }

    try {
      context.plan = await withTimeout(
        this.provider.plan(prompt, context.history, callOptions),
        this.stepTimeoutMs,
        'Planner timed out'
      )

      const steps = context.plan.steps.slice(0, this.maxIterations)
      const planStepId = createStepId()
      yield createEvent('agent.step.started', {
        stepId: planStepId,
        kind: 'plan',
        title: `Created ${steps.length}-step plan`
      })
      yield createEvent('agent.step.completed', { stepId: planStepId })

      let completedSteps = 0
      for (let index = 0; index < steps.length; index += 1) {
        if (signal?.aborted) {
          break
        }

        const step = steps[index]
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

        if (step.toolCall) {
          const toolStepId = createStepId()
          const outcome = yield* this.executeToolStep(toolStepId, stepEventId, step.toolCall)
          if (outcome.ok) {
            context.toolResults[step.id] = outcome.output
          } else {
            context.notes.push(outcome.error)
          }
        }

        const note = await withTimeout(
          this.provider.execute(step, context, callOptions),
          this.stepTimeoutMs,
          'Execution step timed out'
        )
        if (note) {
          context.notes.push(note)
        }
        yield createEvent('agent.step.completed', {
          stepId: stepEventId,
          ...(note ? { summary: note } : {})
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
