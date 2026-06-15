import { parseRetryAfterMs, rateLimitPayloadSchema } from '@tinytinkerer/contracts'
import { RateLimitError } from '@tinytinkerer/app-core'

const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000

const getRetryAfterMs = (value: string | null | undefined): number =>
  parseRetryAfterMs(value) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS

const isValidRetryAt = (value: string | undefined): value is string =>
  Boolean(value && !Number.isNaN(Date.parse(value)))

// Builds a RateLimitError from a 429 response, preferring the structured
// rate-limit payload and falling back to the Retry-After header. Shared by every
// edge call (synthesis, planning, ReAct decisions) so a rate-limited request of
// any kind funnels into the runtime's cooldown/retry path instead of surfacing
// as a generic failure. Consumes the response body — callers must not read it
// again afterwards.
export const createRateLimitError = async (response: Response): Promise<RateLimitError> => {
  const rawText = await response.text()
  const parsed = (() => {
    try {
      return rateLimitPayloadSchema.parse(JSON.parse(rawText))
    } catch {
      return undefined
    }
  })()

  const retryAfterMs = parsed?.retryAfterMs ?? getRetryAfterMs(response.headers.get('retry-after'))
  const retryAt = isValidRetryAt(parsed?.retryAt)
    ? parsed.retryAt
    : new Date(Date.now() + retryAfterMs).toISOString()

  return new RateLimitError(parsed?.error ?? (rawText || 'The model service is rate limited'), {
    retryAfterMs,
    retryAt
  })
}
