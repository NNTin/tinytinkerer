import { SHARED_CREDENTIAL_KEY, type CredentialKey } from './rate-limit'
import type { CallerIdentity } from './caller-validation'

/**
 * Short-TTL cache for SUCCESSFUL caller validations (issue #177).
 *
 * Every models route validates the caller's GitHub identity (an uncached
 * api.github.com/user round trip) before using that identity to resolve a
 * per-user LiteLLM virtual key. A single ReAct prompt fans out into several
 * edge calls — each decision step plus synthesis — so without a cache each
 * prompt pays the ~100–300 ms probe several times over AND burns the caller's
 * GitHub API rate limit (5,000 req/h per token) for no new information.
 *
 * Positive results ONLY: `invalid` and `unavailable` are never cached, so a
 * revoked token bites within {@link VALID_TTL_MS} and a GitHub outage is never
 * sticky. Entries are keyed by the SHA-256 credential hash from
 * {@link deriveCredentialKey} — the raw token never lands in a map key or Cache
 * API URL. The cached body stores the GitHub id/login returned by `/user`, so
 * model routes can resolve per-user LiteLLM keys without re-probing GitHub on
 * every ReAct step.
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

type CachedCallerIdentity = {
  identity: CallerIdentity
  validUntilMs: number
}

// In-memory mirror: credential key -> GitHub identity + validated-until epoch ms.
const validCallerByCredential = new Map<CredentialKey, CachedCallerIdentity>()

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
): Promise<CallerIdentity | undefined> => {
  // The shared fallback bucket means "we could not hash the credential" —
  // caching under it would validate every caller off one token. Never serve it.
  if (credentialKey === SHARED_CREDENTIAL_KEY) return undefined

  const inMemory = validCallerByCredential.get(credentialKey)
  if (inMemory && inMemory.validUntilMs > nowMs) return inMemory.identity

  const store = cacheStore()
  if (!store) return undefined
  try {
    const hit = await store.match(cacheKeyForCredential(credentialKey))
    if (!hit) return undefined
    const untilMs = Number(hit.headers.get(VALIDATED_UNTIL_HEADER) ?? '0')
    if (untilMs <= nowMs) return undefined
    const identity = (await hit.json()) as CallerIdentity
    if (!identity.id || !identity.login) return undefined
    validCallerByCredential.set(credentialKey, {
      identity,
      validUntilMs: untilMs
    })
    return identity
  } catch {
    // A malformed cache entry must never break the request — just re-probe.
    return undefined
  }
}

/** Record a successful validation in both layers for {@link VALID_TTL_MS}. */
export const writeCachedCallerValidation = async (
  credentialKey: CredentialKey,
  identity: CallerIdentity,
  nowMs = Date.now()
): Promise<void> => {
  if (credentialKey === SHARED_CREDENTIAL_KEY) return

  const untilMs = nowMs + VALID_TTL_MS
  validCallerByCredential.set(credentialKey, { identity, validUntilMs: untilMs })

  const store = cacheStore()
  if (!store) return
  try {
    const response = new Response(JSON.stringify(identity), {
      headers: {
        'content-type': 'application/json',
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
  validCallerByCredential.clear()
}
