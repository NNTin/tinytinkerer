import {
  parseRetryAfterMs,
  rateLimitPayloadSchema,
  type RateLimitPayload
} from '@tinytinkerer/contracts'

export { parseRetryAfterMs }

const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000
const RATE_LIMIT_ERROR = 'LiteLLM rate limit reached'

// Cap the upstream-body preview we log so a verbose (or sensitive) 429 body is
// never written to the logs verbatim — a truncated, whitespace-collapsed
// summary is enough to recognise the upstream error class (security LOW-2).
const RATE_LIMIT_BODY_LOG_MAX = 200

export const toRateLimitResponse = (
  rawText: string,
  retryAfter: string | null
): RateLimitPayload => {
  if (rawText) {
    const summary = rawText.replace(/\s+/g, ' ').trim()
    console.error('[rate-limit] upstream 429 body', {
      length: rawText.length,
      preview:
        summary.length > RATE_LIMIT_BODY_LOG_MAX
          ? `${summary.slice(0, RATE_LIMIT_BODY_LOG_MAX - 1)}…`
          : summary
    })
  }
  const retryAfterMs = parseRetryAfterMs(retryAfter) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS
  const retryAt = new Date(Date.now() + retryAfterMs).toISOString()

  return rateLimitPayloadSchema.parse({
    code: 'rate_limited',
    error: RATE_LIMIT_ERROR,
    retryAfterMs,
    retryAt
  })
}

/** Build a rate-limit payload directly from a known remaining delay (ms). */
export const rateLimitResponseFromMs = (
  retryAfterMs: number
): RateLimitPayload =>
  rateLimitPayloadSchema.parse({
    code: 'rate_limited',
    error: RATE_LIMIT_ERROR,
    retryAfterMs,
    retryAt: new Date(Date.now() + retryAfterMs).toISOString()
  })

// Backoff window for the upstream LiteLLM proxy. When upstream returns a 429 we
// remember when its rate-limit window clears (from Retry-After /
// x-ratelimit-reset) and short-circuit subsequent calls until then, so we
// respect the upstream headers instead of re-hammering the provider on every
// retry (TINYTINKERER-EDGE-4 / FRONTEND-5).
//
// The window is scoped per credential (issue #146). All callers share the
// edge-managed LiteLLM key, but the credential-key INPUT includes the resolved
// base URL (see liteLLMSharedCredentialKeyInput in routes/models.ts), so
// distinct allowlisted LiteLLM deployments keep separate windows: one
// deployment's 429 must not short-circuit another that still has quota left.
// The credential input is hashed into a {@link CredentialKey} (see
// {@link deriveCredentialKey}) so the raw key never lands in a map key or
// cache URL.
//
// Two layers: a per-isolate in-memory mirror (cheap, synchronous) and a durable
// colo-wide window in the Workers Cache API. The in-memory layer ALONE is what
// PR #100 shipped — and why the 429s regressed: a fresh Cloudflare isolate
// starts with no window, so under any real concurrency each new isolate
// re-probed upstream and tripped the limit again. The list route papered over
// this with a durable model-catalogue cache, but the (non-cacheable) chat route
// has no such cache, so its backoff MUST be durable to actually stop the
// hammering. See .agent/skills/sentry-debugging (diagnose-regression.md).

/** Opaque, non-reversible scope for the caller's credential. See {@link deriveCredentialKey}. */
export type CredentialKey = string

/** Fallback scope for callers without (or before we can hash) a credential. */
export const SHARED_CREDENTIAL_KEY: CredentialKey = 'shared'

/**
 * Hash the caller's Authorization header into a short, stable, non-reversible
 * key so the backoff window can be scoped per credential without ever storing
 * the raw token in a map key or Cache API URL. Distinct tokens map to distinct
 * keys (SHA-256); a missing token or unavailable Web Crypto degrades to the
 * {@link SHARED_CREDENTIAL_KEY} bucket — never throwing on the request path.
 */
export const deriveCredentialKey = async (
  authorization: string | null | undefined
): Promise<CredentialKey> => {
  if (!authorization) return SHARED_CREDENTIAL_KEY
  try {
    const data = new TextEncoder().encode(authorization)
    const digest = await crypto.subtle.digest('SHA-256', data)
    let hex = ''
    for (const byte of new Uint8Array(digest)) {
      hex += byte.toString(16).padStart(2, '0')
    }
    // 16 bytes of SHA-256 is ample to keep buckets collision-free in practice.
    return hex.slice(0, 32)
  } catch {
    return SHARED_CREDENTIAL_KEY
  }
}

// In-memory mirror keyed by the credential scope.
const backoffUntilMsByScope = new Map<string, number>()

/** Remaining in-memory backoff in ms (0 when cleared / never set). */
export const getModelsBackoffMs = (
  nowMs = Date.now(),
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): number => {
  const backoffUntilMs = backoffUntilMsByScope.get(credentialKey) ?? 0
  return backoffUntilMs > nowMs ? backoffUntilMs - nowMs : 0
}

/** Extend the in-memory backoff window to cover the upstream-advertised delay. */
export const recordModelsBackoff = (
  retryAfterMs: number,
  nowMs = Date.now(),
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): void => {
  backoffUntilMsByScope.set(
    credentialKey,
    Math.max(backoffUntilMsByScope.get(credentialKey) ?? 0, nowMs + retryAfterMs)
  )
}

/** Clear the in-memory backoff after a confirmed successful upstream response. */
export const clearModelsBackoff = (
  credentialKey?: CredentialKey
): void => {
  if (credentialKey) {
    backoffUntilMsByScope.delete(credentialKey)
    return
  }
  backoffUntilMsByScope.clear()
}

// --- Durable, colo-wide backoff window (Workers Cache API) --------------------
//
// Mirrors lib/models-cache.ts: `caches.default` persists across requests and
// isolates within a Cloudflare colo, and is absent under vitest/Node, where
// every function below degrades to the in-memory mirror so tests stay
// synchronous and hermetic.

// Scoped per credential so a window opened for one LiteLLM deployment is not
// honoured for a different one (issue #146). The literal `litellm` path segment
// is kept so entries written by per-provider builds simply expire unused.
const backoffCacheKey = (credentialKey: CredentialKey): string =>
  `https://models-backoff.tiny.nntin.xyz/litellm/${credentialKey}/window`
const BACKOFF_UNTIL_HEADER = 'x-models-backoff-until'

const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

const readDurableBackoffUntilMs = async (
  credentialKey: CredentialKey
): Promise<number> => {
  const store = cacheStore()
  if (!store) return 0
  try {
    const hit = await store.match(backoffCacheKey(credentialKey))
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
export const getActiveBackoffMs = async (
  nowMs = Date.now(),
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): Promise<number> => {
  const durableUntil = await readDurableBackoffUntilMs(credentialKey)
  if (durableUntil > nowMs) {
    recordModelsBackoff(durableUntil - nowMs, nowMs, credentialKey)
  }
  return getModelsBackoffMs(nowMs, credentialKey)
}

/** Record an upstream retry window in both the in-memory mirror and the colo cache. */
export const recordBackoff = async (
  retryAfterMs: number,
  nowMs = Date.now(),
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): Promise<void> => {
  recordModelsBackoff(retryAfterMs, nowMs, credentialKey)
  const store = cacheStore()
  if (!store) return
  try {
    const untilMs = backoffUntilMsByScope.get(credentialKey) ?? 0
    const response = new Response('', {
      headers: {
        // Auto-evict the entry once the window elapses.
        'cache-control': `max-age=${Math.max(1, Math.ceil((untilMs - nowMs) / 1000))}`,
        [BACKOFF_UNTIL_HEADER]: String(untilMs)
      }
    })
    await store.put(backoffCacheKey(credentialKey), response)
  } catch {
    // Best-effort: a write failure just means the next isolate may re-probe once.
  }
}

/** Clear the backoff in both layers after a confirmed successful upstream response. */
export const clearBackoff = async (
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): Promise<void> => {
  clearModelsBackoff(credentialKey)
  const store = cacheStore()
  if (!store) return
  try {
    await store.delete(backoffCacheKey(credentialKey))
  } catch {
    // Best-effort.
  }
}
