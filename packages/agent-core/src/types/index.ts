import type { ExecutionPlan, PlanStep } from '@tinytinkerer/types'

export type ExecutionContext = {
  prompt: string
  plan: ExecutionPlan
  notes: string[]
  toolResults: Record<string, unknown>
}

export type ProviderCallOptions = {
  signal?: AbortSignal
}

export interface ModelProvider {
  plan(prompt: string, options?: ProviderCallOptions): Promise<ExecutionPlan>
  execute(step: PlanStep, context: ExecutionContext, options?: ProviderCallOptions): Promise<string>
  synthesize(context: ExecutionContext, options?: ProviderCallOptions): AsyncIterable<string>
}
