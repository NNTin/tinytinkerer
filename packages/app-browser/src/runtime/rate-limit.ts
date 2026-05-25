import { parseRetryAfterMs } from '@tinytinkerer/contracts'

export { parseRetryAfterMs }

const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000

export const getRetryAfterMs = (value: string | null | undefined): number =>
  parseRetryAfterMs(value) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS
