const SOFT_THROTTLE_THRESHOLD = 0.05
const MIN_JITTER_MS = 50
const MAX_JITTER_MS = 300

const jitter = (): number => MIN_JITTER_MS + Math.random() * (MAX_JITTER_MS - MIN_JITTER_MS)

const parseNonNegativeInt = (headers: Headers, name: string): number | undefined => {
  const raw = headers.get(name)
  if (raw === null) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

// Default renewal window used as the reset fallback when the upstream omits a
// usable x-ratelimit-reset-* value (LiteLLM windows are minute-scoped).
const DEFAULT_RENEWAL_MS = 60_000

// LiteLLM sends x-ratelimit-reset-* as either relative seconds (<= 86400) or absolute Unix epoch seconds.
const resolveResetAt = (resetSec: number | undefined, nowMs: number): number => {
  if (resetSec === undefined || resetSec <= 0) return nowMs + DEFAULT_RENEWAL_MS
  return resetSec > 86400 ? resetSec * 1000 : nowMs + resetSec * 1000
}

type QuotaWindow = {
  limit: number
  remaining: number
  resetAt: number
}

export type ThrottleResult = {
  shouldThrottle: boolean
  waitMs: number
  reason: 'request_quota' | 'token_quota' | 'heuristic' | 'none'
}

export class RateLimitQuota {
  private requests: QuotaWindow | null = null
  private tokens: QuotaWindow | null = null
  // Absolute end of the post-429 backoff (amplified, with jitter applied once).
  private heuristicUntil = 0

  updateFromHeaders(headers: Headers, nowMs = Date.now()): void {
    const limitReq = parseNonNegativeInt(headers, 'x-ratelimit-limit-requests')
    const remainingReq = parseNonNegativeInt(headers, 'x-ratelimit-remaining-requests')
    const resetReq = parseNonNegativeInt(headers, 'x-ratelimit-reset-requests')

    const limitTok = parseNonNegativeInt(headers, 'x-ratelimit-limit-tokens')
    const remainingTok = parseNonNegativeInt(headers, 'x-ratelimit-remaining-tokens')
    const resetTok = parseNonNegativeInt(headers, 'x-ratelimit-reset-tokens')

    if (limitReq !== undefined && remainingReq !== undefined) {
      this.requests = {
        limit: limitReq,
        remaining: remainingReq,
        resetAt: resolveResetAt(resetReq, nowMs)
      }
    }

    if (limitTok !== undefined && remainingTok !== undefined) {
      this.tokens = {
        limit: limitTok,
        remaining: remainingTok,
        resetAt: resolveResetAt(resetTok, nowMs)
      }
    }
  }

  // Call after a confirmed successful response to clear any heuristic backoff.
  clearHeuristicBackoff(): void {
    this.heuristicUntil = 0
  }

  // Returns the backoff deadline. Amplify slightly and add jitter to discourage
  // an immediate retry storm. The provider hands this same deadline to the
  // runtime's cooldown (issue #533), so a retry issued once it has passed is not
  // throttled again: one window is waited out exactly once.
  recordRateLimit(retryAfterMs: number, nowMs = Date.now()): number {
    this.heuristicUntil = Math.max(
      this.heuristicUntil,
      Math.ceil(nowMs + retryAfterMs * 1.1 + jitter())
    )
    return this.heuristicUntil
  }

  checkThrottle(estimatedTokens = 0, nowMs = Date.now()): ThrottleResult {
    const requests = this.requests
    const tokens = this.tokens

    if (!requests && !tokens) {
      return this.checkHeuristic(nowMs)
    }

    if (requests && nowMs < requests.resetAt) {
      if (requests.remaining <= 0) {
        return {
          shouldThrottle: true,
          waitMs: requests.resetAt - nowMs + jitter(),
          reason: 'request_quota'
        }
      }
      const threshold = Math.ceil(requests.limit * SOFT_THROTTLE_THRESHOLD)
      if (requests.remaining < threshold) {
        const urgency = 1 - requests.remaining / threshold
        return { shouldThrottle: true, waitMs: urgency * 500 + jitter(), reason: 'request_quota' }
      }
    }

    if (tokens && nowMs < tokens.resetAt && estimatedTokens > 0) {
      if (tokens.remaining <= 0 || tokens.remaining < estimatedTokens) {
        return {
          shouldThrottle: true,
          waitMs: tokens.resetAt - nowMs + jitter(),
          reason: 'token_quota'
        }
      }
      const threshold = Math.ceil(tokens.limit * SOFT_THROTTLE_THRESHOLD)
      if (tokens.remaining < threshold) {
        const urgency = 1 - tokens.remaining / threshold
        return { shouldThrottle: true, waitMs: urgency * 500 + jitter(), reason: 'token_quota' }
      }
    }

    return this.checkHeuristic(nowMs)
  }

  private checkHeuristic(nowMs: number): ThrottleResult {
    const remaining = this.heuristicUntil - nowMs
    return remaining > 0
      ? { shouldThrottle: true, waitMs: remaining, reason: 'heuristic' }
      : { shouldThrottle: false, waitMs: 0, reason: 'none' }
  }
}
