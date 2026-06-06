import {
  parseRetryAfterMs,
  rateLimitPayloadSchema,
  type ModelProviderId,
  type RateLimitPayload
} from '@tinytinkerer/contracts'

export { parseRetryAfterMs }

const DEFAULT_RATE_LIMIT_RETRY_AFTER_MS = 60_000

export const toRateLimitResponse = (
  rawText: string,
  retryAfter: string | null,
  provider: ModelProviderId = 'github'
): RateLimitPayload => {
  if (rawText) {
    console.error('[rate-limit] upstream 429 body', rawText)
  }
  const retryAfterMs = parseRetryAfterMs(retryAfter) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS
  const retryAt = new Date(Date.now() + retryAfterMs).toISOString()

  return rateLimitPayloadSchema.parse({
    code: 'rate_limited',
    error:
      provider === 'openrouter'
        ? 'OpenRouter rate limit reached'
        : 'GitHub Models rate limit reached',
    retryAfterMs,
    retryAt
  })
}

/** Build a rate-limit payload directly from a known remaining delay (ms). */
export const rateLimitResponseFromMs = (
  retryAfterMs: number,
  provider: ModelProviderId = 'github'
): RateLimitPayload =>
  rateLimitPayloadSchema.parse({
    code: 'rate_limited',
    error:
      provider === 'openrouter'
        ? 'OpenRouter rate limit reached'
        : 'GitHub Models rate limit reached',
    retryAfterMs,
    retryAt: new Date(Date.now() + retryAfterMs).toISOString()
  })

// Backoff window for upstream model providers. When upstream returns a 429 we
// remember when its rate-limit window clears (from Retry-After /
// x-ratelimit-reset) and short-circuit subsequent calls until then, so we
// respect the upstream headers instead of re-hammering the provider on every
// retry (TINYTINKERER-EDGE-4 / FRONTEND-5).
//
// The window is scoped per (provider, credential), NOT per provider alone. Each
// authenticated caller forwards their own GitHub token / OpenRouter key, so they
// draw on SEPARATE upstream quotas: a 429 triggered by one caller's credential
// must not short-circuit a different caller who still has quota left. Keying the
// backoff only by provider made one user's rate limit fence off everyone else in
// the colo (issue #146). The credential is hashed into a {@link CredentialKey}
// (see {@link deriveCredentialKey}) so the raw token never lands in a map key or
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

// In-memory mirror keyed by the composite (provider, credential) scope.
const scopeKey = (
  provider: ModelProviderId,
  credentialKey: CredentialKey
): string => `${provider}:${credentialKey}`

const backoffUntilMsByScope = new Map<string, number>()

/** Remaining in-memory backoff in ms (0 when cleared / never set). */
export const getModelsBackoffMs = (
  nowMs = Date.now(),
  provider: ModelProviderId = 'github',
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): number => {
  const backoffUntilMs = backoffUntilMsByScope.get(scopeKey(provider, credentialKey)) ?? 0
  return backoffUntilMs > nowMs ? backoffUntilMs - nowMs : 0
}

/** Extend the in-memory backoff window to cover the upstream-advertised delay. */
export const recordModelsBackoff = (
  retryAfterMs: number,
  nowMs = Date.now(),
  provider: ModelProviderId = 'github',
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): void => {
  const key = scopeKey(provider, credentialKey)
  backoffUntilMsByScope.set(
    key,
    Math.max(backoffUntilMsByScope.get(key) ?? 0, nowMs + retryAfterMs)
  )
}

/** Clear the in-memory backoff after a confirmed successful upstream response. */
export const clearModelsBackoff = (
  provider?: ModelProviderId,
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): void => {
  if (provider) {
    backoffUntilMsByScope.delete(scopeKey(provider, credentialKey))
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

// Scoped per (provider, credential) so a window opened by one caller's token is
// not honoured for a different caller's token (issue #146).
const backoffCacheKey = (
  provider: ModelProviderId,
  credentialKey: CredentialKey
): string =>
  `https://models-backoff.tiny.nntin.xyz/${provider}/${credentialKey}/window`
const BACKOFF_UNTIL_HEADER = 'x-models-backoff-until'

const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

const readDurableBackoffUntilMs = async (
  provider: ModelProviderId,
  credentialKey: CredentialKey
): Promise<number> => {
  const store = cacheStore()
  if (!store) return 0
  try {
    const hit = await store.match(backoffCacheKey(provider, credentialKey))
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
  provider: ModelProviderId = 'github',
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): Promise<number> => {
  const durableUntil = await readDurableBackoffUntilMs(provider, credentialKey)
  if (durableUntil > nowMs) {
    recordModelsBackoff(durableUntil - nowMs, nowMs, provider, credentialKey)
  }
  return getModelsBackoffMs(nowMs, provider, credentialKey)
}

/** Record an upstream retry window in both the in-memory mirror and the colo cache. */
export const recordBackoff = async (
  retryAfterMs: number,
  nowMs = Date.now(),
  provider: ModelProviderId = 'github',
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): Promise<void> => {
  recordModelsBackoff(retryAfterMs, nowMs, provider, credentialKey)
  const store = cacheStore()
  if (!store) return
  try {
    const untilMs = backoffUntilMsByScope.get(scopeKey(provider, credentialKey)) ?? 0
    const response = new Response('', {
      headers: {
        // Auto-evict the entry once the window elapses.
        'cache-control': `max-age=${Math.max(1, Math.ceil((untilMs - nowMs) / 1000))}`,
        [BACKOFF_UNTIL_HEADER]: String(untilMs)
      }
    })
    await store.put(backoffCacheKey(provider, credentialKey), response)
  } catch {
    // Best-effort: a write failure just means the next isolate may re-probe once.
  }
}

/** Clear the backoff in both layers after a confirmed successful upstream response. */
export const clearBackoff = async (
  provider: ModelProviderId = 'github',
  credentialKey: CredentialKey = SHARED_CREDENTIAL_KEY
): Promise<void> => {
  clearModelsBackoff(provider, credentialKey)
  const store = cacheStore()
  if (!store) return
  try {
    await store.delete(backoffCacheKey(provider, credentialKey))
  } catch {
    // Best-effort.
  }
}
