import { SHARED_CREDENTIAL_KEY, type CredentialKey } from './rate-limit'
import type { CallerIdentity } from './caller-validation'
import { ExpiringMap } from './expiring-map'
import { numericHeader, readDurable, writeDurable } from './durable-cache'

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
 * Uses the shared two-layer pattern from ./durable-cache: a per-isolate
 * in-memory map (cheap, synchronous) plus a durable colo-wide entry in the
 * Workers Cache API, which is absent under vitest/Node where the in-memory
 * layer alone applies.
 */

/** How long a successful validation is trusted before re-probing GitHub. */
const VALID_TTL_MS = 5 * 60_000

const VALIDATED_UNTIL_HEADER = 'x-caller-validated-until'

const cacheKeyForCredential = (credentialKey: CredentialKey): string =>
  `https://caller-validation-cache.tiny.nntin.xyz/github/${credentialKey}`

// In-memory mirror: credential key -> GitHub identity, expiring at the
// validated-until stamp. Expired entries are actively evicted — one entry per
// unique credential would otherwise accumulate for the isolate's lifetime
// (issue #343).
const validCallerByCredential = new ExpiringMap<CredentialKey, CallerIdentity>()

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

  const inMemory = validCallerByCredential.get(credentialKey, nowMs)
  if (inMemory) return inMemory

  return readDurable(cacheKeyForCredential(credentialKey), async (hit) => {
    const untilMs = numericHeader(hit, VALIDATED_UNTIL_HEADER)
    if (untilMs === undefined || untilMs <= nowMs) return undefined
    const identity = (await hit.json()) as CallerIdentity
    if (!identity.id || !identity.login) return undefined
    validCallerByCredential.set(credentialKey, identity, untilMs, nowMs)
    return identity
  })
}

/** Record a successful validation in both layers for {@link VALID_TTL_MS}. */
export const writeCachedCallerValidation = async (
  credentialKey: CredentialKey,
  identity: CallerIdentity,
  nowMs = Date.now()
): Promise<void> => {
  if (credentialKey === SHARED_CREDENTIAL_KEY) return

  const untilMs = nowMs + VALID_TTL_MS
  validCallerByCredential.set(credentialKey, identity, untilMs, nowMs)

  await writeDurable(cacheKeyForCredential(credentialKey), {
    maxAgeSeconds: Math.ceil(VALID_TTL_MS / 1000),
    headers: { 'content-type': 'application/json', [VALIDATED_UNTIL_HEADER]: String(untilMs) },
    body: JSON.stringify(identity)
  })
}

/** Reset the in-memory mirror (tests only — module state leaks across cases). */
export const clearCallerValidationCache = (): void => {
  validCallerByCredential.clear()
}

/** Entry count of the in-memory mirror (tests only — observes #343 eviction). */
export const callerValidationCacheSize = (): number => validCallerByCredential.size
