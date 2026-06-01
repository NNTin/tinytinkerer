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

// Backoff window for GitHub Models. When upstream returns a 429 we remember when
// its rate-limit window clears (from Retry-After / x-ratelimit-reset) and
// short-circuit subsequent calls until then, so we respect the upstream headers
// instead of re-hammering models.github.ai on every retry (TINYTINKERER-EDGE-4 /
// FRONTEND-5). Shared by the chat and list routes since both draw on the same
// GitHub Models quota.
//
// Two layers: a per-isolate in-memory mirror (cheap, synchronous) and a durable
// colo-wide window in the Workers Cache API. The in-memory layer ALONE is what
// PR #100 shipped — and why the 429s regressed: a fresh Cloudflare isolate
// starts with `backoffUntilMs = 0`, so under any real concurrency each new
// isolate re-probed upstream and tripped the limit again. The list route papered
// over this with a durable model-catalogue cache, but the (non-cacheable) chat
// route has no such cache, so its backoff MUST be durable to actually stop the
// hammering. See .agent/skills/sentry-debugging (diagnose-regression.md).
let backoffUntilMs = 0

/** Remaining in-memory backoff in ms (0 when cleared / never set). */
export const getModelsBackoffMs = (nowMs = Date.now()): number =>
  backoffUntilMs > nowMs ? backoffUntilMs - nowMs : 0

/** Extend the in-memory backoff window to cover the upstream-advertised delay. */
export const recordModelsBackoff = (retryAfterMs: number, nowMs = Date.now()): void => {
  backoffUntilMs = Math.max(backoffUntilMs, nowMs + retryAfterMs)
}

/** Clear the in-memory backoff after a confirmed successful upstream response. */
export const clearModelsBackoff = (): void => {
  backoffUntilMs = 0
}

// --- Durable, colo-wide backoff window (Workers Cache API) --------------------
//
// Mirrors lib/models-cache.ts: `caches.default` persists across requests and
// isolates within a Cloudflare colo, and is absent under vitest/Node, where
// every function below degrades to the in-memory mirror so tests stay
// synchronous and hermetic.

const BACKOFF_CACHE_KEY = 'https://models-backoff.tiny.nntin.xyz/window'
const BACKOFF_UNTIL_HEADER = 'x-models-backoff-until'

const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

const readDurableBackoffUntilMs = async (): Promise<number> => {
  const store = cacheStore()
  if (!store) return 0
  try {
    const hit = await store.match(BACKOFF_CACHE_KEY)
    if (!hit) return 0
    return Number(hit.headers.get(BACKOFF_UNTIL_HEADER) ?? '0')
  } catch {
    return 0
  }
}

/**
 * Remaining backoff in ms across BOTH layers. Reads the durable window, folds it
 * into the in-memory mirror (so repeat calls in this isolate are cheap), and
 * returns the larger of the two. Use this — not {@link getModelsBackoffMs} — on
 * the request path so a window opened by another isolate is honoured here too.
 */
export const getActiveBackoffMs = async (nowMs = Date.now()): Promise<number> => {
  const durableUntil = await readDurableBackoffUntilMs()
  if (durableUntil > nowMs) {
    recordModelsBackoff(durableUntil - nowMs, nowMs)
  }
  return getModelsBackoffMs(nowMs)
}

/** Record an upstream retry window in both the in-memory mirror and the colo cache. */
export const recordBackoff = async (retryAfterMs: number, nowMs = Date.now()): Promise<void> => {
  recordModelsBackoff(retryAfterMs, nowMs)
  const store = cacheStore()
  if (!store) return
  try {
    const untilMs = backoffUntilMs
    const response = new Response('', {
      headers: {
        // Auto-evict the entry once the window elapses.
        'cache-control': `max-age=${Math.max(1, Math.ceil((untilMs - nowMs) / 1000))}`,
        [BACKOFF_UNTIL_HEADER]: String(untilMs)
      }
    })
    await store.put(BACKOFF_CACHE_KEY, response)
  } catch {
    // Best-effort: a write failure just means the next isolate may re-probe once.
  }
}

/** Clear the backoff in both layers after a confirmed successful upstream response. */
export const clearBackoff = async (): Promise<void> => {
  clearModelsBackoff()
  const store = cacheStore()
  if (!store) return
  try {
    await store.delete(BACKOFF_CACHE_KEY)
  } catch {
    // Best-effort.
  }
}
