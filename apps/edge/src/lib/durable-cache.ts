/**
 * Shared durable-cache layer for the edge worker's short-TTL caches (issue #365).
 *
 * lib/rate-limit.ts, lib/inbound-rate-limit.ts, lib/caller-validation-cache.ts,
 * lib/litellm-user-keys.ts and lib/models-cache.ts each keep the same two-layer
 * shape: a per-isolate in-memory mirror (cheap, synchronous) plus a durable
 * colo-wide entry in the Workers Cache API (`caches.default`), which persists
 * across requests and isolates within a Cloudflare colo but is absent under
 * vitest/Node — where every function below degrades to a no-op so consumers
 * fall back to the in-memory mirror alone. This module consolidates the
 * `cacheStore` lookup, the match/put/delete try/catch boilerplate, and the
 * header-parsing helpers that used to be duplicated across those five modules.
 */

/**
 * Cloudflare exposes a non-standard default cache at `caches.default`. The DOM
 * `CacheStorage` lib type (and we don't pull in @cloudflare/workers-types)
 * doesn't declare it, so reach it through a narrow cast and feature-detect.
 */
export const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

/**
 * Read and parse a durable cache entry. Returns `undefined` when the durable
 * cache is unavailable (vitest/Node) or on a miss. `parse` extracts the
 * caller's value from the hit `Response`; the whole match+parse is wrapped in
 * one try/catch — a malformed cache entry must never break the request.
 */
export const readDurable = async <T>(
  url: string,
  parse: (hit: Response) => T | undefined | Promise<T | undefined>
): Promise<T | undefined> => {
  const store = cacheStore()
  if (!store) return undefined
  try {
    const hit = await store.match(url)
    if (!hit) return undefined
    return await parse(hit)
  } catch {
    return undefined
  }
}

/**
 * Write a durable cache entry, best-effort. A no-op when the durable cache is
 * unavailable; a write failure otherwise just means the next isolate re-probes
 * or undercounts once.
 */
export const writeDurable = async (
  url: string,
  {
    maxAgeSeconds,
    headers = {},
    body = ''
  }: { maxAgeSeconds: number; headers?: Record<string, string>; body?: string }
): Promise<void> => {
  const store = cacheStore()
  if (!store) return
  try {
    const response = new Response(body, {
      headers: {
        // Auto-evict the entry once its window elapses.
        'cache-control': `max-age=${maxAgeSeconds}`,
        ...headers
      }
    })
    await store.put(url, response)
  } catch {
    // Best-effort: a write failure just means the next isolate may re-probe once.
  }
}

/** Delete a durable cache entry, best-effort (a no-op when the cache is unavailable). */
export const deleteDurable = async (url: string): Promise<void> => {
  const store = cacheStore()
  if (!store) return
  try {
    await store.delete(url)
  } catch {
    // Best-effort.
  }
}

/**
 * A numeric header value, or `undefined` when the header is missing OR its
 * value is not a finite number (e.g. a malformed/truncated cache entry).
 */
export const numericHeader = (hit: Response, name: string): number | undefined => {
  const raw = hit.headers.get(name)
  if (raw === null) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/** Max-age (seconds, rounded up, floored at 1) for an entry valid until `untilMs`. */
export const remainingMaxAgeSeconds = (untilMs: number, nowMs: number): number =>
  Math.max(1, Math.ceil((untilMs - nowMs) / 1000))
