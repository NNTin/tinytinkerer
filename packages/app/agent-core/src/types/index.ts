import type {
  ContentDocument,
  ExecutionPlan,
  PlanStep,
  ReActDecision
} from '@tinytinkerer/contracts'

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

// A single piece of the synthesized response stream. `content` chunks build the
// final answer; `reasoning` chunks carry the model's raw chain-of-thought when
// the underlying model emits it (otherwise none are produced and consumers fall
// back to the structured activity timeline).
// `usage` chunks are best-effort and terminal: a provider that requests
// `stream_options.include_usage` emits a single one carrying the call's token
// counts after the content stream. Consumers that don't care ignore it (it has
// no `text`); the runtime turns it into an `agent.usage` event.
export type SynthesisChunk =
  | { kind: 'content'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'usage'; promptTokens: number; completionTokens?: number; totalTokens?: number }

// A chunk of a streamed ReAct decision: `thought` carries the model's reasoning
// as it streams (full accumulated text), and `decision` is the final structured
// choice. Used by the optional streaming decision path.
export type DecisionChunk =
  | { kind: 'thought'; text: string }
  | { kind: 'decision'; decision: ReActDecision }

export interface ModelProvider {
  plan(
    prompt: string,
    history: ConversationMessage[],
    options?: ProviderCallOptions
  ): Promise<ExecutionPlan>
  execute(step: PlanStep, context: ExecutionContext, options?: ProviderCallOptions): Promise<string>
  synthesize(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): AsyncIterable<SynthesisChunk>
  // Decide the next ReAct action (a single tool call) or to finish, given the
  // observations accumulated so far in `context`. Required by the ReAct and
  // Hybrid runtimes; optional so Plan-then-Execute-only providers (and existing
  // test mocks) need not implement it. The runtimes that need it guard at run
  // start and surface a clear error when it is absent.
  decideNextAction?(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): Promise<ReActDecision>
  // Streaming variant of decideNextAction: yields the model's reasoning as it
  // streams, then the final decision. When present, the ReAct/Hybrid runtimes
  // prefer it so per-step thoughts render live; otherwise they fall back to
  // decideNextAction.
  streamDecision?(
    context: ExecutionContext,
    options?: ProviderCallOptions
  ): AsyncIterable<DecisionChunk>
}

export type AssistantContentSnapshot = {
  source: string
  content: ContentDocument
}

export interface AssistantContentSession {
  append(chunk: string): AssistantContentSnapshot
  replace(source: string): AssistantContentSnapshot
  snapshot(): AssistantContentSnapshot
}

export type CreateAssistantContentSession = (
  initialSource?: string
) => AssistantContentSession | Promise<AssistantContentSession>
