import type { ExecutionPlan, PlanStep } from '@tinytinkerer/contracts'

const SEARCH_KEYWORDS = /latest|news|search|web|compare|today|research/i

export const inferPlan = (
  prompt: string,
  options?: { searchEnabled?: boolean }
): ExecutionPlan => {
  const needsSearch = options?.searchEnabled !== false && SEARCH_KEYWORDS.test(prompt)
  const steps: PlanStep[] = [{ id: 'understand', summary: 'Understand request constraints' }]

  if (needsSearch) {
    steps.push({
      id: 'search',
      summary: 'Collect current references from web search',
      toolCall: { toolId: 'web-search', input: { query: prompt, maxResults: 5 } }
    })
  }

  steps.push({ id: 'compose', summary: 'Compose final answer' })

  return { complexity: needsSearch ? 'medium' : 'low', steps }
}
