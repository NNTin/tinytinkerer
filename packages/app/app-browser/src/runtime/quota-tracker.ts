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
  private heuristicBackoffMs = 0
  private lastRateLimitAt = 0

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
        resetAt: resolveResetAt(resetReq, nowMs),
      }
    }

    if (limitTok !== undefined && remainingTok !== undefined) {
      this.tokens = {
        limit: limitTok,
        remaining: remainingTok,
        resetAt: resolveResetAt(resetTok, nowMs),
      }
    }
  }

  // Call after a confirmed successful response to clear any heuristic backoff.
  clearHeuristicBackoff(): void {
    this.heuristicBackoffMs = 0
  }

  recordRateLimit(retryAfterMs: number, nowMs = Date.now()): void {
    this.lastRateLimitAt = nowMs
    // Amplify slightly to discourage an immediate retry storm
    this.heuristicBackoffMs = Math.max(this.heuristicBackoffMs, retryAfterMs * 1.1)
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
          reason: 'request_quota',
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
          reason: 'token_quota',
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
    if (this.heuristicBackoffMs > 0) {
      const elapsed = nowMs - this.lastRateLimitAt
      const remaining = this.heuristicBackoffMs - elapsed
      if (remaining > 0) {
        return { shouldThrottle: true, waitMs: remaining + jitter(), reason: 'heuristic' }
      }
      this.heuristicBackoffMs = 0
    }
    return { shouldThrottle: false, waitMs: 0, reason: 'none' }
  }
}
