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

type QuotaWindow = {
  limit: number
  remaining: number
  resetAt: number
  renewalPeriodMs: number
}

export type ThrottleResult = {
  shouldThrottle: boolean
  waitMs: number
  reason: 'request_quota' | 'token_quota' | 'abuse_penalty' | 'heuristic' | 'none'
}

export class RateLimitQuota {
  private requests: QuotaWindow | null = null
  private tokens: QuotaWindow | null = null
  private abuseActive = false
  private heuristicBackoffMs = 0
  private lastRateLimitAt = 0

  updateFromHeaders(headers: Headers, nowMs = Date.now()): void {
    const limitReq = parseNonNegativeInt(headers, 'x-ratelimit-limit-requests')
    const remainingReq = parseNonNegativeInt(headers, 'x-ratelimit-remaining-requests')
    const resetReq = parseNonNegativeInt(headers, 'x-ratelimit-reset-requests')
    const renewalReq = parseNonNegativeInt(headers, 'x-ratelimit-renewalperiod-requests')

    const limitTok = parseNonNegativeInt(headers, 'x-ratelimit-limit-tokens')
    const remainingTok = parseNonNegativeInt(headers, 'x-ratelimit-remaining-tokens')
    const resetTok = parseNonNegativeInt(headers, 'x-ratelimit-reset-tokens')
    const renewalTok = parseNonNegativeInt(headers, 'x-ratelimit-renewalperiod-tokens')

    const abusePenalty = headers.get('x-ratelimit-abusepenalty-active')

    if (limitReq !== undefined && remainingReq !== undefined) {
      const renewalMs = (renewalReq ?? 60) * 1000
      this.requests = {
        limit: limitReq,
        remaining: remainingReq,
        resetAt: nowMs + (resetReq !== undefined && resetReq > 0 ? resetReq * 1000 : renewalMs),
        renewalPeriodMs: renewalMs,
      }
    }

    if (limitTok !== undefined && remainingTok !== undefined) {
      const renewalMs = (renewalTok ?? 60) * 1000
      this.tokens = {
        limit: limitTok,
        remaining: remainingTok,
        resetAt: nowMs + (resetTok !== undefined && resetTok > 0 ? resetTok * 1000 : renewalMs),
        renewalPeriodMs: renewalMs,
      }
    }

    this.abuseActive = abusePenalty !== null && abusePenalty.toLowerCase() === 'true'

    // Clear heuristic backoff on a successful response
    this.heuristicBackoffMs = 0
  }

  recordRateLimit(retryAfterMs: number, nowMs = Date.now()): void {
    this.lastRateLimitAt = nowMs
    // Amplify slightly to discourage an immediate retry storm
    this.heuristicBackoffMs = Math.max(this.heuristicBackoffMs, retryAfterMs * 1.1)
  }

  checkThrottle(estimatedTokens = 0, nowMs = Date.now()): ThrottleResult {
    if (this.abuseActive) {
      return { shouldThrottle: true, waitMs: 5000 + jitter(), reason: 'abuse_penalty' }
    }

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

    return { shouldThrottle: false, waitMs: 0, reason: 'none' }
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
