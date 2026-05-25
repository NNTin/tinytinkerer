import { parseRetryAfterMs, rateLimitPayloadSchema, type RateLimitPayload } from '@tinytinkerer/contracts'

export { parseRetryAfterMs }

const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000

export const toRateLimitResponse = (
  rawText: string,
  retryAfter: string | null
): RateLimitPayload => {
  if (rawText) {
    console.error('[rate-limit] upstream 429 body', rawText)
  }
  const retryAfterMs = parseRetryAfterMs(retryAfter) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS
  const retryAt = new Date(Date.now() + retryAfterMs).toISOString()

  return rateLimitPayloadSchema.parse({
    code: 'rate_limited',
    error: 'GitHub Models rate limit reached',
    retryAfterMs,
    retryAt
  })
}
