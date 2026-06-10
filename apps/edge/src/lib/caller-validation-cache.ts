import { SHARED_CREDENTIAL_KEY, type CredentialKey } from './rate-limit'

/**
 * Short-TTL cache for SUCCESSFUL caller validations (issue #177).
 *
 * Every models route validates the caller's GitHub identity (an uncached
 * api.github.com/user round trip) before using the shared LiteLLM key. A single
 * ReAct prompt fans out into several edge calls — each decision step plus
 * synthesis — so without a cache each prompt pays the ~100–300 ms probe several
 * times over AND burns the caller's GitHub API rate limit (5,000 req/h per
 * token) for no new information.
 *
 * Positive results ONLY: `invalid` and `unavailable` are never cached, so a
 * revoked token bites within {@link VALID_TTL_MS} and a GitHub outage is never
 * sticky. Entries are keyed by the SHA-256 credential hash from
 * {@link deriveCredentialKey} — the raw token never lands in a map key or Cache
 * API URL. If per-user access control lands (#176) and validation starts
 * carrying identity, store it alongside the validated-until timestamp here.
 *
 * Mirrors the two-layer pattern of ./rate-limit: a per-isolate in-memory map
 * (cheap, synchronous) plus a durable colo-wide entry in the Workers Cache API,
 * which is absent under vitest/Node where the in-memory layer alone applies.
 */

/** How long a successful validation is trusted before re-probing GitHub. */
const VALID_TTL_MS = 5 * 60_000

const VALIDATED_UNTIL_HEADER = 'x-caller-validated-until'

const cacheKeyForCredential = (credentialKey: CredentialKey): string =>
  `https://caller-validation-cache.tiny.nntin.xyz/github/${credentialKey}`

// In-memory mirror: credential key -> validated-until epoch ms.
const validUntilMsByCredential = new Map<CredentialKey, number>()

const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

/**
 * Whether this credential passed validation within the TTL. Reads the durable
 * entry on an in-memory miss and folds it into the mirror so repeat calls in
 * this isolate stay synchronous-cheap.
 */
export const readCachedCallerValidation = async (
  credentialKey: CredentialKey,
  nowMs = Date.now()
): Promise<boolean> => {
  // The shared fallback bucket means "we could not hash the credential" —
  // caching under it would validate every caller off one token. Never serve it.
  if (credentialKey === SHARED_CREDENTIAL_KEY) return false

  const inMemoryUntil = validUntilMsByCredential.get(credentialKey) ?? 0
  if (inMemoryUntil > nowMs) return true

  const store = cacheStore()
  if (!store) return false
  try {
    const hit = await store.match(cacheKeyForCredential(credentialKey))
    if (!hit) return false
    const untilMs = Number(hit.headers.get(VALIDATED_UNTIL_HEADER) ?? '0')
    if (untilMs <= nowMs) return false
    validUntilMsByCredential.set(credentialKey, untilMs)
    return true
  } catch {
    // A malformed cache entry must never break the request — just re-probe.
    return false
  }
}

/** Record a successful validation in both layers for {@link VALID_TTL_MS}. */
export const writeCachedCallerValidation = async (
  credentialKey: CredentialKey,
  nowMs = Date.now()
): Promise<void> => {
  if (credentialKey === SHARED_CREDENTIAL_KEY) return

  const untilMs = nowMs + VALID_TTL_MS
  validUntilMsByCredential.set(credentialKey, untilMs)

  const store = cacheStore()
  if (!store) return
  try {
    const response = new Response('', {
      headers: {
        // Auto-evict the entry once the TTL elapses.
        'cache-control': `max-age=${Math.ceil(VALID_TTL_MS / 1000)}`,
        [VALIDATED_UNTIL_HEADER]: String(untilMs)
      }
    })
    await store.put(cacheKeyForCredential(credentialKey), response)
  } catch {
    // Best-effort: a write failure just means the next call re-probes once.
  }
}

/** Reset the in-memory mirror (tests only — module state leaks across cases). */
export const clearCallerValidationCache = (): void => {
  validUntilMsByCredential.clear()
}
