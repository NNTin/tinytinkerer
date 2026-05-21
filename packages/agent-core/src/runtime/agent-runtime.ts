import type { ChatEvent, PlanStep } from '@tinytinkerer/types'
import { withTimeout } from '@tinytinkerer/shared'
import { createEvent } from '../events/create-event'
import type { ExecutionContext, ModelProvider } from '../types'
import { ToolRegistry } from '../tools/registry'

type AgentRuntimeOptions = {
  maxIterations?: number
  maxToolCallsPerStep?: number
  toolTimeoutMs?: number
  stepTimeoutMs?: number
}

export class AgentRuntime {
  private readonly maxIterations: number
  private readonly maxToolCallsPerStep: number
  private readonly toolTimeoutMs: number
  private readonly stepTimeoutMs: number

  constructor(
    private readonly provider: ModelProvider,
    private readonly registry: ToolRegistry,
    options: AgentRuntimeOptions = {}
  ) {
    this.maxIterations = options.maxIterations ?? 5
    this.maxToolCallsPerStep = options.maxToolCallsPerStep ?? 1
    this.toolTimeoutMs = options.toolTimeoutMs ?? 10_000
    this.stepTimeoutMs = options.stepTimeoutMs ?? 15_000
  }

  async *run(prompt: string): AsyncGenerator<ChatEvent> {
    const context: ExecutionContext = {
      prompt,
      plan: {
        complexity: 'low',
        steps: []
      },
      notes: [],
      toolResults: {}
    }

    yield createEvent('user.message', { text: prompt })
    yield createEvent('planning.started', { summary: 'Understanding request' })

    try {
      context.plan = await withTimeout(
        this.provider.plan(prompt),
        this.stepTimeoutMs,
        'Planner timed out'
      )
      yield createEvent('plan.generated', { plan: context.plan })
      yield createEvent('execution.started', { steps: context.plan.steps.length })

      const steps = context.plan.steps.slice(0, this.maxIterations)

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index]
        if (!step) {
          continue
        }

        yield createEvent('execution.step.started', { step, index })
        if (step.toolCall) {
          const toolEventStream = this.executeTool(step)
          for await (const toolEvent of toolEventStream) {
            if (toolEvent.type === 'tool.call.completed') {
              context.toolResults[step.id] = toolEvent.payload.output
            }
            if (toolEvent.type === 'tool.call.failed') {
              context.notes.push(toolEvent.payload.error)
            }
            yield toolEvent
          }
        }

        const note = await withTimeout(
          this.provider.execute(step, context),
          this.stepTimeoutMs,
          'Execution step timed out'
        )
        context.notes.push(note)
        yield createEvent('execution.step.completed', { stepId: step.id, note })
      }

      let output = ''
      for await (const chunk of this.provider.synthesize(context)) {
        output += chunk
        yield createEvent('assistant.chunk', { text: chunk })
      }

      yield createEvent('assistant.done', { text: output.trim() })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown runtime error'
      yield createEvent('error', { message })
      yield createEvent('assistant.done', { text: 'I hit an execution issue. Please try again.' })
    }
  }

  private async *executeTool(step: PlanStep): AsyncGenerator<ChatEvent> {
    if (!step.toolCall) {
      return
    }

    const { toolId, input } = step.toolCall
    yield createEvent('tool.call.started', { toolId, input })

    if (this.maxToolCallsPerStep < 1) {
      yield createEvent('tool.call.failed', {
        toolId,
        error: 'Tool calls disabled by runtime policy'
      })
      return
    }

    try {
      const output = await withTimeout(
        this.registry.run(toolId, input),
        this.toolTimeoutMs,
        `Tool ${toolId} timed out`
      )
      yield createEvent('tool.call.completed', { toolId, output })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed'
      yield createEvent('tool.call.failed', { toolId, error: message })
    }
  }
}
