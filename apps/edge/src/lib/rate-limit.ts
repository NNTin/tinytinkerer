import { rateLimitPayloadSchema, type RateLimitPayload } from '@tinytinkerer/contracts'

const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000

export const parseRetryAfterMs = (
  value: string | null | undefined,
  nowMs = Date.now()
): number | undefined => {
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

export const toRateLimitResponse = (
  rawText: string,
  retryAfter: string | null
): RateLimitPayload => {
  const retryAfterMs = parseRetryAfterMs(retryAfter) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS
  const retryAt = new Date(Date.now() + retryAfterMs).toISOString()

  return rateLimitPayloadSchema.parse({
    code: 'rate_limited',
    error: rawText || 'GitHub Models is rate limited',
    retryAfterMs,
    retryAt
  })
}
