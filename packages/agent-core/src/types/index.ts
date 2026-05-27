import type {
  AssistantContentDocument,
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

export interface ModelProvider {
  plan(prompt: string, options?: ProviderCallOptions): Promise<ExecutionPlan>
  execute(step: PlanStep, context: ExecutionContext, options?: ProviderCallOptions): Promise<string>
  synthesize(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<string>
}

export type AssistantContentSnapshot = {
  source: string
  content: AssistantContentDocument
}

export interface AssistantContentSession {
  append(chunk: string): AssistantContentSnapshot
  replace(source: string): AssistantContentSnapshot
  snapshot(): AssistantContentSnapshot
}

export type CreateAssistantContentSession = (
  initialSource?: string
) => AssistantContentSession | Promise<AssistantContentSession>
