import {
  AgentRuntime,
  RateLimitError as AgentRateLimitError,
  HybridRuntime,
  ReActRuntime,
  runChatEventHooks,
  ToolRegistry
} from '@tinytinkerer/agent-core'
import type {
  AgentRuntimeBase,
  AgentHookContribution,
  CreateAssistantContentSession,
  DecisionChunk,
  ExecutionContext as AgentExecutionContext,
  ModelProvider as AgentModelProvider,
  ProviderCallOptions as AgentProviderCallOptions,
  RuntimeErrorReporter,
  SynthesisChunk,
  Tool as AgentTool
} from '@tinytinkerer/agent-core'
import type { AgentType, ExecutionPlan, PlanStep, ReActDecision } from '@tinytinkerer/contracts'
import type { ChatRuntime } from './ports'

export type { DecisionChunk, RuntimeErrorReporter, SynthesisChunk } from '@tinytinkerer/agent-core'

// Surface the runtime timeout error + guard through the app-core boundary so the
// host (app-browser) can classify a terminal timeout as a Sentry warning rather
// than a hard error, mirroring how RateLimitError is re-exported here.
export { RuntimeTimeoutError, isRuntimeTimeoutError } from '@tinytinkerer/agent-core'

// Re-export the plugin runtime surface so app-browser composes plugins through
// the app-core boundary, mirroring how `Tool` is surfaced here.
export { PluginRegistry, isPluginModule } from '@tinytinkerer/agent-core'
export type {
  AgentPlugin,
  ChatEventHookContext,
  PluginHost,
  PluginReport,
  PluginCaptureSink,
  PluginManifest,
  PluginModule,
  PluginToolDescriptor,
  ActivityView,
  ActivitySummarizer,
  AgentHookContribution,
  ToolExecutionContext,
  ToolGateResult,
  PermissionRequest,
  PermissionRequestService,
  PluginEdgeFetch,
  PluginEdgeResponse,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxCodeExecutor,
  DomQuery,
  DomNodeResult,
  DomReadResult,
  DomReader
} from '@tinytinkerer/agent-core'

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
  streamDecision?(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<DecisionChunk>
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
  firstChunkTimeoutMs?: number
  searchEnabled?: boolean
  createAssistantContentSession?: CreateAssistantContentSession
  reportError?: RuntimeErrorReporter
  hooks?: readonly AgentHookContribution[]
  hookTimeoutMs?: number
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
    ...(options.firstChunkTimeoutMs !== undefined
      ? { firstChunkTimeoutMs: options.firstChunkTimeoutMs }
      : {}),
    ...(options.searchEnabled !== undefined ? { searchEnabled: options.searchEnabled } : {}),
    ...(options.createAssistantContentSession
      ? { createAssistantContentSession: options.createAssistantContentSession }
      : {}),
    ...(options.reportError ? { reportError: options.reportError } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
    ...(options.hookTimeoutMs !== undefined ? { hookTimeoutMs: options.hookTimeoutMs } : {})
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

  if (!options.hooks || options.hooks.length === 0) {
    return runtime
  }

  const hooks = options.hooks
  return {
    async *run(prompt, runOptions) {
      for await (const event of runtime.run(prompt, runOptions)) {
        await runChatEventHooks(hooks, { event })
        yield event
      }
    }
  }
}

// The app-core and agent-core layers each define their own RateLimitError;
// translate the app-core flavour thrown by providers into the agent-core one the
// runtime recognises, so a rate limit from any provider call (synthesis or a
// ReAct decision) reaches the runtime's cooldown/retry path instead of being
// treated as a generic failure.
const toAgentError = (error: unknown): unknown =>
  isRateLimitError(error)
    ? new AgentRateLimitError(error.message, {
        retryAfterMs: error.retryAfterMs,
        retryAt: error.retryAt
      })
    : error

const createProviderAdapter = (provider: ModelProvider): AgentModelProvider => ({
  async plan(prompt: string, history: ConversationMessage[], options?: AgentProviderCallOptions) {
    try {
      return await provider.plan(prompt, history, options)
    } catch (error) {
      throw toAgentError(error)
    }
  },
  async execute(step: PlanStep, context: AgentExecutionContext, options?: AgentProviderCallOptions) {
    try {
      return await provider.execute(step, toExecutionContext(context), options)
    } catch (error) {
      throw toAgentError(error)
    }
  },
  // Forward the optional ReAct decision method only when the wrapped provider
  // implements it, so the adapter mirrors the provider's capabilities exactly.
  ...(provider.decideNextAction
    ? {
        async decideNextAction(context: AgentExecutionContext, options?: AgentProviderCallOptions) {
          try {
            return await provider.decideNextAction!(toExecutionContext(context), options)
          } catch (error) {
            throw toAgentError(error)
          }
        }
      }
    : {}),
  ...(provider.streamDecision
    ? {
        async *streamDecision(context: AgentExecutionContext, options?: AgentProviderCallOptions) {
          try {
            yield* provider.streamDecision!(toExecutionContext(context), options)
          } catch (error) {
            throw toAgentError(error)
          }
        }
      }
    : {}),
  async *synthesize(context: AgentExecutionContext, options?: AgentProviderCallOptions) {
    try {
      yield* provider.synthesize(toExecutionContext(context), options)
    } catch (error) {
      throw toAgentError(error)
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
