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

/** Build a rate-limit payload directly from a known remaining delay (ms). */
export const rateLimitResponseFromMs = (retryAfterMs: number): RateLimitPayload =>
  rateLimitPayloadSchema.parse({
    code: 'rate_limited',
    error: 'GitHub Models rate limit reached',
    retryAfterMs,
    retryAt: new Date(Date.now() + retryAfterMs).toISOString()
  })

// Best-effort, per-isolate backoff window for GitHub Models. When upstream
// returns a 429 we remember when its rate-limit window clears (from Retry-After
// / x-ratelimit-reset) and short-circuit subsequent calls until then, so we
// respect the upstream headers instead of re-hammering models.github.ai on
// every retry (TINYTINKERER-EDGE-4 / FRONTEND-5). Shared by the chat and list
// routes since both draw on the same GitHub Models quota.
let backoffUntilMs = 0

/** Remaining backoff in ms (0 when the window has cleared / was never set). */
export const getModelsBackoffMs = (nowMs = Date.now()): number =>
  backoffUntilMs > nowMs ? backoffUntilMs - nowMs : 0

/** Extend the backoff window to cover the upstream-advertised retry delay. */
export const recordModelsBackoff = (retryAfterMs: number, nowMs = Date.now()): void => {
  backoffUntilMs = Math.max(backoffUntilMs, nowMs + retryAfterMs)
}

/** Clear the backoff after a confirmed successful upstream response. */
export const clearModelsBackoff = (): void => {
  backoffUntilMs = 0
}
