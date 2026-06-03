import type { GitHubModelEntry, ModelProviderId } from '@tinytinkerer/contracts'

/**
 * Durable, colo-wide cache for the GitHub Models catalogue.
 *
 * The `/v1/models` list is identical for every authenticated caller and changes
 * rarely, so it is highly cacheable. PR #100 only added a *reactive* backoff
 * (see {@link ./rate-limit}) that lives in per-isolate module memory — a fresh
 * Cloudflare isolate resets it to zero, so under any real concurrency we kept
 * re-probing `models.github.ai` and tripping its rate limit (the regression
 * behind TINYTINKERER-EDGE-4 / FRONTEND-5).
 *
 * This cache fixes the root cause: it persists across requests and isolates
 * within a Cloudflare colo (via the Workers Cache API), so after the first
 * successful fetch we serve the catalogue from cache and stop hammering
 * upstream entirely for {@link FRESH_TTL_MS}. We keep the entry around for
 * {@link STALE_TTL_MS} so that, when upstream is rate limited, we can serve the
 * last-known list instead of cascading a raw 429 to the browser.
 *
 * Outside Cloudflare (tests, local Node) `caches.default` is absent; every
 * function below degrades to a no-op so callers fall back to a live fetch.
 */

// Stable synthetic key — the catalogue is global, not per-token, so one cached
// entry serves every user in the colo. Exported as a test seam for seeding.
export const CACHE_KEY = 'https://models-list-cache.tiny.nntin.xyz/github/v1/models'

const cacheKeyForProvider = (provider: ModelProviderId): string =>
  `https://models-list-cache.tiny.nntin.xyz/${provider}/v1/models`

/** Within this age the cached list is served without touching upstream. */
const FRESH_TTL_MS = 5 * 60_000
/** Older-but-still-usable window: served only as a fallback on an upstream 429. */
const STALE_TTL_MS = 60 * 60_000

const CACHED_AT_HEADER = 'x-models-cached-at'

export type CachedModels = { models: GitHubModelEntry[]; ageMs: number }

// Cloudflare exposes a non-standard default cache at `caches.default`. The DOM
// `CacheStorage` lib type (and we don't pull in @cloudflare/workers-types)
// doesn't declare it, so reach it through a narrow cast and feature-detect.
const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

/** Whether a cached entry of the given age can be served without a refetch. */
export const isFresh = (ageMs: number): boolean => ageMs <= FRESH_TTL_MS

/** Read the cached catalogue, or `undefined` on a miss / when caching is unavailable. */
export const readCachedModels = async (
  provider: ModelProviderId = 'github',
  nowMs = Date.now()
): Promise<CachedModels | undefined> => {
  const store = cacheStore()
  if (!store) return undefined

  try {
    const hit = await store.match(cacheKeyForProvider(provider))
    if (!hit) return undefined
    const cachedAt = Number(hit.headers.get(CACHED_AT_HEADER) ?? '0')
    const models = (await hit.json()) as GitHubModelEntry[]
    return { models, ageMs: Math.max(0, nowMs - cachedAt) }
  } catch {
    // A malformed/partial cache entry must never break the request.
    return undefined
  }
}

/** Store the catalogue so subsequent requests (and isolates) skip the upstream fetch. */
export const writeCachedModels = async (
  models: GitHubModelEntry[],
  provider: ModelProviderId = 'github',
  nowMs = Date.now()
): Promise<void> => {
  const store = cacheStore()
  if (!store || models.length === 0) return

  try {
    const response = new Response(JSON.stringify(models), {
      headers: {
        'content-type': 'application/json',
        // The Cache API evicts on max-age, so keep entries for the stale window;
        // freshness is judged separately from the stored timestamp.
        'cache-control': `max-age=${Math.ceil(STALE_TTL_MS / 1000)}`,
        [CACHED_AT_HEADER]: String(nowMs)
      }
    })
    await store.put(cacheKeyForProvider(provider), response)
  } catch {
    // Caching is best-effort; a write failure just means the next request refetches.
  }
}
