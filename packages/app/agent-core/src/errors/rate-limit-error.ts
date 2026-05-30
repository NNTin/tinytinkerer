type RateLimitErrorOptions = {
  retryAfterMs: number
  retryAt: string
}

export class RateLimitError extends Error {
  readonly retryAfterMs: number
  readonly retryAt: string

  constructor(message: string, options: RateLimitErrorOptions) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = options.retryAfterMs
    this.retryAt = options.retryAt
  }
}

export const isRateLimitError = (error: unknown): error is RateLimitError => error instanceof RateLimitError
