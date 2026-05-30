import type {
  ContentDocument,
  ExecutionPlan,
  PlanStep
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
export type SynthesisChunk =
  | { kind: 'content'; text: string }
  | { kind: 'reasoning'; text: string }

export interface ModelProvider {
  plan(prompt: string, history: ConversationMessage[], options?: ProviderCallOptions): Promise<ExecutionPlan>
  execute(step: PlanStep, context: ExecutionContext, options?: ProviderCallOptions): Promise<string>
  synthesize(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<SynthesisChunk>
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
