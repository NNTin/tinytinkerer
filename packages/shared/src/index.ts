import type { ExecutionPlan, PlanStep } from '@tinytinkerer/contracts'

export type { ExecutionPlan, PlanStep }

const SEARCH_KEYWORDS = /latest|news|search|web|compare|today|research/i

export const inferPlan = (prompt: string, options?: { searchEnabled?: boolean }): ExecutionPlan => {
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

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000
export const MAX_AUTO_RETRY_AFTER_MS = 300_000

export const parseRetryAfterMs = (value: string | null | undefined, nowMs = Date.now()): number | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000)
  }

  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - nowMs)
  }

  return undefined
}

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
