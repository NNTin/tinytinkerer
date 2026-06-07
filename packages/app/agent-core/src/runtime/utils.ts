import { RuntimeTimeoutError } from '../errors/timeout-error'

export const MAX_AUTO_RETRY_AFTER_MS = 300_000

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    // Reject with a typed RuntimeTimeoutError (not a bare Error) so the terminal
    // handler can classify the timeout as a Sentry *warning* rather than a hard
    // error — see RuntimeTimeoutError (TINYTINKERER-FRONTEND-S).
    timeoutId = setTimeout(() => reject(new RuntimeTimeoutError(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}
