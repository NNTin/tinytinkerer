import type { ChatEvent, PlanStep } from '@tinytinkerer/contracts'
import { isRateLimitError } from '../errors/rate-limit-error'
import { createEvent } from '../events/create-event'
import type {
  AssistantContentSession,
  ConversationMessage,
  CreateAssistantContentSession,
  ExecutionContext,
  ModelProvider
} from '../types'
import { ToolRegistry } from '../tools/registry'
import { MAX_AUTO_RETRY_AFTER_MS, withTimeout } from './utils'

type AgentRuntimeOptions = {
  maxIterations?: number
  maxToolCallsPerStep?: number
  toolTimeoutMs?: number
  stepTimeoutMs?: number
  searchEnabled?: boolean
  createAssistantContentSession?: CreateAssistantContentSession
}

type RunOptions = {
  signal?: AbortSignal
  history?: ConversationMessage[]
}

export class AgentRuntime {
  private readonly maxIterations: number
  private readonly maxToolCallsPerStep: number
  private readonly toolTimeoutMs: number
  private readonly stepTimeoutMs: number
  private readonly searchEnabled: boolean
  private readonly createAssistantContentSession: CreateAssistantContentSession

  constructor(
    private readonly provider: ModelProvider,
    private readonly registry: ToolRegistry,
    options: AgentRuntimeOptions = {}
  ) {
    this.maxIterations = options.maxIterations ?? 5
    this.maxToolCallsPerStep = options.maxToolCallsPerStep ?? 1
    this.toolTimeoutMs = options.toolTimeoutMs ?? 10_000
    this.stepTimeoutMs = options.stepTimeoutMs ?? 15_000
    this.searchEnabled = options.searchEnabled ?? true
    this.createAssistantContentSession =
      options.createAssistantContentSession ?? createPlainTextAssistantContentSession
  }

  async *run(prompt: string, options: RunOptions = {}): AsyncGenerator<ChatEvent> {
    const { signal } = options
    const context: ExecutionContext = {
      prompt,
      history: options.history ?? [],
      plan: {
        complexity: 'low',
        steps: []
      },
      notes: [],
      toolResults: {}
    }

    yield createEvent('user.message', { text: prompt })
    yield createEvent('planning.started', { summary: 'Understanding request' })

    const callOptions = { ...(signal ? { signal } : {}), searchEnabled: this.searchEnabled }

    try {
      context.plan = await withTimeout(
        this.provider.plan(prompt, context.history, callOptions),
        this.stepTimeoutMs,
        'Planner timed out'
      )
      yield createEvent('plan.generated', { plan: context.plan })

      const steps = context.plan.steps.slice(0, this.maxIterations)
      yield createEvent('execution.started', { steps: steps.length })

      let completedSteps = 0
      for (let index = 0; index < steps.length; index += 1) {
        if (signal?.aborted) {
          break
        }

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
          this.provider.execute(step, context, callOptions),
          this.stepTimeoutMs,
          'Execution step timed out'
        )
        if (note) {
          context.notes.push(note)
        }
        yield createEvent('execution.step.completed', { stepId: step.id, note })
        completedSteps += 1
      }

      yield createEvent('execution.completed', { steps: completedSteps })

      if (signal?.aborted) {
        yield createEvent('assistant.done', (await this.createAssistantContentSession()).snapshot())
        return
      }

      yield* this.synthesizeWithRateLimit(context, signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield createEvent('assistant.done', (await this.createAssistantContentSession()).snapshot())
        return
      }
      const message = error instanceof Error ? error.message : 'Unknown runtime error'
      yield createEvent('error', { message })
      yield createEvent(
        'assistant.done',
        (await this.createAssistantContentSession()).replace('I hit an execution issue. Please try again.')
      )
    }
  }

  private async *executeTool(step: PlanStep): AsyncGenerator<ChatEvent> {
    if (!step.toolCall) {
      return
    }

    const { toolId, input } = step.toolCall

    if (this.maxToolCallsPerStep < 1) {
      yield createEvent('tool.call.failed', {
        toolId,
        error: 'Tool calls disabled by runtime policy'
      })
      return
    }

    yield createEvent('tool.call.started', { toolId, input })

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
      const session = await this.createAssistantContentSession()
      let reasoningText = ''
      try {
        const synthesizeOptions = signal ? { signal } : undefined
        for await (const chunk of this.provider.synthesize(context, synthesizeOptions)) {
          if (chunk.kind === 'reasoning') {
            reasoningText += chunk.text
            yield createEvent('reasoning.chunk', {
              source: session.snapshot().source,
              text: reasoningText
            })
            continue
          }
          yield createEvent('assistant.chunk', session.append(chunk.text))
        }

        if (reasoningText.trim().length > 0) {
          yield createEvent('reasoning.done', {
            source: session.snapshot().source,
            text: reasoningText
          })
        }
        yield createEvent('assistant.done', session.snapshot())
        return
      } catch (error) {
        if (!isRateLimitError(error)) {
          throw error
        }

        // Clear any live reasoning state so a stale partial reasoning chunk from
        // the failed attempt does not persist into the retry or terminal response.
        if (reasoningText.trim().length > 0) {
          yield createEvent('reasoning.done', {
            source: session.snapshot().source,
            text: ''
          })
        }

        const autoRetry = error.retryAfterMs <= MAX_AUTO_RETRY_AFTER_MS

        if (!autoRetry) {
          yield createEvent('rate.limit.cancelled', {
            retryAfterMs: error.retryAfterMs,
            retryAt: error.retryAt,
            message: error.message,
            reason: 'too_long'
          })
          yield createEvent(
            'assistant.done',
            session.replace(
              'GitHub Models is rate limited. This request was cancelled because the cooldown is longer than five minutes.'
            )
          )
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
          yield createEvent('assistant.done', session.replace('Retry cancelled.'))
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

const createPlainTextAssistantContentSession = (
  initialSource = ''
): AssistantContentSession => {
  let source = initialSource

  const snapshot = () => ({
    source,
    content:
      source.trim().length > 0
        ? {
            nodes: [
              {
                type: 'paragraph' as const,
                children: [{ type: 'text' as const, value: source }]
              }
            ]
          }
        : { nodes: [] }
  })

  return {
    append(chunk) {
      source += chunk
      return snapshot()
    },
    replace(nextSource) {
      source = nextSource
      return snapshot()
    },
    snapshot
  }
}
