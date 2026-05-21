import type { ExecutionPlan, PlanStep } from '@tinytinkerer/types'

export type ExecutionContext = {
  prompt: string
  plan: ExecutionPlan
  notes: string[]
  toolResults: Record<string, unknown>
}

export interface ModelProvider {
  plan(prompt: string): Promise<ExecutionPlan>
  execute(step: PlanStep, context: ExecutionContext): Promise<string>
  synthesize(context: ExecutionContext): AsyncIterable<string>
}
