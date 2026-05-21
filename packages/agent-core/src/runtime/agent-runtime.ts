import type { ChatEvent, PlanStep } from '@tinytinkerer/types'
import { MAX_AUTO_RETRY_AFTER_MS, withTimeout } from '@tinytinkerer/shared'
import { isRateLimitError } from '../errors/rate-limit-error'
import { createEvent } from '../events/create-event'
import type { ExecutionContext, ModelProvider } from '../types'
import { ToolRegistry } from '../tools/registry'

type AgentRuntimeOptions = {
  maxIterations?: number
  maxToolCallsPerStep?: number
  toolTimeoutMs?: number
  stepTimeoutMs?: number
}

type RunOptions = {
  signal?: AbortSignal
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

  async *run(prompt: string, options: RunOptions = {}): AsyncGenerator<ChatEvent> {
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

      yield* this.synthesizeWithRateLimit(context, options.signal)
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

  private async *synthesizeWithRateLimit(
    context: ExecutionContext,
    signal: AbortSignal | undefined
  ): AsyncGenerator<ChatEvent> {
    while (true) {
      try {
        const chunks: string[] = []
        const synthesizeOptions = signal ? { signal } : undefined
        for await (const chunk of this.provider.synthesize(context, synthesizeOptions)) {
          chunks.push(chunk)
        }

        for (const chunk of chunks) {
          yield createEvent('assistant.chunk', { text: chunk })
        }

        yield createEvent('assistant.done', { text: chunks.join('').trim() })
        return
      } catch (error) {
        if (!isRateLimitError(error)) {
          throw error
        }

        const autoRetry = error.retryAfterMs <= MAX_AUTO_RETRY_AFTER_MS

        if (!autoRetry) {
          yield createEvent('rate.limit.cancelled', {
            retryAfterMs: error.retryAfterMs,
            retryAt: error.retryAt,
            message: error.message,
            reason: 'too_long'
          })
          yield createEvent('assistant.done', {
            text: 'GitHub Models is rate limited. This request was cancelled because the cooldown is longer than five minutes.'
          })
          return
        }

        yield createEvent('rate.limit.waiting', {
          retryAfterMs: error.retryAfterMs,
          retryAt: error.retryAt,
          message: error.message,
          autoRetry: true
        })

        const elapsed = await this.waitUntil(error.retryAt, signal)
        if (!elapsed) {
          yield createEvent('rate.limit.cancelled', {
            retryAfterMs: error.retryAfterMs,
            retryAt: error.retryAt,
            message: 'Retry cancelled',
            reason: 'cancelled'
          })
          yield createEvent('assistant.done', { text: 'Retry cancelled.' })
          return
        }

        yield createEvent('rate.limit.recovered', { retryAt: error.retryAt })
      }
    }
  }

  private waitUntil(retryAt: string, signal: AbortSignal | undefined): Promise<boolean> {
    if (signal?.aborted) {
      return Promise.resolve(false)
    }

    const retryAtMs = Date.parse(retryAt)
    const timeoutMs = Number.isNaN(retryAtMs) ? 0 : Math.max(0, retryAtMs - Date.now())

    return new Promise((resolve) => {
      const cleanup = () => {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', onAbort)
      }

      const onAbort = () => {
        cleanup()
        resolve(false)
      }

      const timeoutId = setTimeout(() => {
        cleanup()
        resolve(true)
      }, timeoutMs)

      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}
