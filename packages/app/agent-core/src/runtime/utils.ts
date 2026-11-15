import { RuntimeTimeoutError } from '../errors/timeout-error'

export const MAX_AUTO_RETRY_AFTER_MS = 300_000

// `start` (optional) defers the budget until it resolves, e.g. request dispatch
// after a provider's pre-request wait (#533); it never arms once settled.
export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  start?: Promise<void>
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let settled = false
  const timeoutPromise = new Promise<never>((_, reject) => {
    // Reject with a typed RuntimeTimeoutError (not a bare Error) so the terminal
    // handler can classify the timeout as a Sentry *warning* rather than a hard
    // error — see RuntimeTimeoutError (TINYTINKERER-FRONTEND-S).
    const arm = () => {
      if (!settled)
        timeoutId = setTimeout(() => reject(new RuntimeTimeoutError(message)), timeoutMs)
    }
    if (start) void start.then(arm)
    else arm()
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    settled = true
    clearTimeout(timeoutId)
  }
}
