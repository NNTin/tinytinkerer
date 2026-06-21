import {
  KEYWORD_PROMPT_SENTINEL,
  type ExecutionPlan,
  type KeywordPlannerStep,
  type PlanStep
} from '@tinytinkerer/contracts'

// A tool the heuristic fallback planner may propose: its id plus the optional
// keyword step its owner declared (KeywordPlannerStep). Structurally a subset of
// the host's planner tool descriptor, so a caller can pass its descriptor list
// straight in without reshaping.
export type KeywordFallbackTool = {
  id: string
  keywordPlannerStep?: KeywordPlannerStep
}

// Substitute the KEYWORD_PROMPT_SENTINEL placeholder in an input template with the
// user prompt. Shallow by design — keyword-fallback templates are flat tool inputs,
// so only top-level values exactly equal to the sentinel are replaced (see the
// KeywordPlannerStep.inputTemplate contract).
const fillInputTemplate = (
  template: Record<string, unknown> | undefined,
  prompt: string
): Record<string, unknown> => {
  if (!template) {
    return {}
  }
  const filled: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(template)) {
    filled[key] = value === KEYWORD_PROMPT_SENTINEL ? prompt : value
  }
  return filled
}

// Heuristic fallback planner, used when the LLM planner is unavailable (an
// anonymous user, or a transport failure). It names NO concrete tool: each
// candidate tool carries its own keyword trigger + step template
// (KeywordPlannerStep), so a tool that wants a keyword-fallback step ships one and
// the planner proposes it on a keyword match. A tool with no keywordPlannerStep —
// or whose keywords don't match the prompt — contributes nothing. This replaces
// the previous hard-coded `web-search` step, restoring the no-special-cased-id
// invariant (the keyword logic now travels with the plugin).
export const inferPlan = (
  prompt: string,
  tools: readonly KeywordFallbackTool[] = []
): ExecutionPlan => {
  const steps: PlanStep[] = [{ id: 'understand', summary: 'Understand request constraints' }]
  const lowerPrompt = prompt.toLowerCase()

  for (const tool of tools) {
    const step = tool.keywordPlannerStep
    if (!step) {
      continue
    }
    const matches = step.keywords.some((keyword) => lowerPrompt.includes(keyword.toLowerCase()))
    if (!matches) {
      continue
    }
    steps.push({
      id: step.stepId ?? tool.id,
      summary: step.summary,
      toolCall: { toolId: tool.id, input: fillInputTemplate(step.inputTemplate, prompt) }
    })
  }

  const usedTool = steps.length > 1
  steps.push({ id: 'compose', summary: 'Compose final answer' })

  return { complexity: usedTool ? 'medium' : 'low', steps }
}
