import {
  AgentRuntime,
  RateLimitError as AgentRateLimitError,
  HybridRuntime,
  ReActRuntime,
  ToolRegistry
} from '@tinytinkerer/agent-core'
import type {
  AgentRuntimeBase,
  CreateAssistantContentSession,
  ExecutionContext as AgentExecutionContext,
  ModelProvider as AgentModelProvider,
  ProviderCallOptions as AgentProviderCallOptions,
  SynthesisChunk,
  Tool as AgentTool
} from '@tinytinkerer/agent-core'
import type { AgentType, ExecutionPlan, PlanStep, ReActDecision } from '@tinytinkerer/contracts'
import type { ChatRuntime } from './ports'

export type { SynthesisChunk } from '@tinytinkerer/agent-core'

export type ConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ExecutionContext = {
  prompt: string
  history: ConversationMessage[]
  plan: ExecutionPlan
  notes: string[]
  toolResults: Record<string, unknown>
}

export type ProviderCallOptions = {
  signal?: AbortSignal
  searchEnabled?: boolean
}

export interface ModelProvider {
  plan(prompt: string, history: ConversationMessage[], options?: ProviderCallOptions): Promise<ExecutionPlan>
  execute(step: PlanStep, context: ExecutionContext, options?: ProviderCallOptions): Promise<string>
  synthesize(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<SynthesisChunk>
  decideNextAction?(context: ExecutionContext, options?: ProviderCallOptions): Promise<ReActDecision>
}

export type Tool<Input, Output> = AgentTool<Input, Output>

export class RateLimitError extends Error {
  readonly retryAfterMs: number
  readonly retryAt: string

  constructor(message: string, options: { retryAfterMs: number; retryAt: string }) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = options.retryAfterMs
    this.retryAt = options.retryAt
  }
}

export const isRateLimitError = (error: unknown): error is RateLimitError => error instanceof RateLimitError

export const createChatRuntime = (options: {
  provider: ModelProvider
  agentType?: AgentType
  tools?: Tool<unknown, unknown>[]
  maxIterations?: number
  maxToolCallsPerStep?: number
  toolTimeoutMs?: number
  stepTimeoutMs?: number
  searchEnabled?: boolean
  createAssistantContentSession?: CreateAssistantContentSession
}): ChatRuntime => {
  const registry = new ToolRegistry()
  for (const tool of options.tools ?? []) {
    registry.register(tool)
  }

  const runtimeOptions = {
    ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
    ...(options.maxToolCallsPerStep !== undefined
      ? { maxToolCallsPerStep: options.maxToolCallsPerStep }
      : {}),
    ...(options.toolTimeoutMs !== undefined ? { toolTimeoutMs: options.toolTimeoutMs } : {}),
    ...(options.stepTimeoutMs !== undefined ? { stepTimeoutMs: options.stepTimeoutMs } : {}),
    ...(options.searchEnabled !== undefined ? { searchEnabled: options.searchEnabled } : {}),
    ...(options.createAssistantContentSession
      ? { createAssistantContentSession: options.createAssistantContentSession }
      : {})
  }

  const adaptedProvider = createProviderAdapter(options.provider)

  const runtime: AgentRuntimeBase = (() => {
    switch (options.agentType) {
      case 'react':
        return new ReActRuntime(adaptedProvider, registry, runtimeOptions)
      case 'hybrid':
        return new HybridRuntime(adaptedProvider, registry, runtimeOptions)
      case 'plan-execute':
      default:
        return new AgentRuntime(adaptedProvider, registry, runtimeOptions)
    }
  })()

  return runtime
}

const createProviderAdapter = (provider: ModelProvider): AgentModelProvider => ({
  plan(prompt: string, history: ConversationMessage[], options?: AgentProviderCallOptions) {
    return provider.plan(prompt, history, options)
  },
  execute(step: PlanStep, context: AgentExecutionContext, options?: AgentProviderCallOptions) {
    return provider.execute(step, toExecutionContext(context), options)
  },
  // Forward the optional ReAct decision method only when the wrapped provider
  // implements it, so the adapter mirrors the provider's capabilities exactly.
  ...(provider.decideNextAction
    ? {
        decideNextAction(context: AgentExecutionContext, options?: AgentProviderCallOptions) {
          return provider.decideNextAction!(toExecutionContext(context), options)
        }
      }
    : {}),
  async *synthesize(context: AgentExecutionContext, options?: AgentProviderCallOptions) {
    try {
      yield* provider.synthesize(toExecutionContext(context), options)
    } catch (error) {
      if (isRateLimitError(error)) {
        throw new AgentRateLimitError(error.message, {
          retryAfterMs: error.retryAfterMs,
          retryAt: error.retryAt
        })
      }

      throw error
    }
  }
})

const toExecutionContext = (context: AgentExecutionContext): ExecutionContext => ({
  prompt: context.prompt,
  history: context.history,
  plan: context.plan,
  notes: context.notes,
  toolResults: context.toolResults
})
