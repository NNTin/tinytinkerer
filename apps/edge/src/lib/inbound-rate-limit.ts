import type { MiddlewareHandler } from 'hono'
import { edgeErrorResponseSchema } from '@tinytinkerer/contracts'
import type { Bindings } from './bindings'
import { deriveCredentialKey, SHARED_CREDENTIAL_KEY } from './rate-limit'

/**
 * Inbound (caller-facing) request throttling for the edge worker.
 *
 * lib/rate-limit.ts only handles UPSTREAM 429 backoff — nothing stops a caller
 * from hammering the edge itself. The auth exchange endpoint is fully
 * unauthenticated (anyone can burn GitHub OAuth exchanges), and the search/MCP
 * proxies spend shared server-side resources per request, so each gets a
 * fixed-window per-caller counter: requests beyond the limit are answered 429 +
 * Retry-After without running the route handler.
 *
 * Callers are bucketed per credential when an Authorization header is present
 * (hashed via {@link deriveCredentialKey} — the raw token never lands in a map
 * key or Cache API URL), else per client IP (cf-connecting-ip, hashed the same
 * way). Limits are configurable per scope via bindings (see {@link Bindings});
 * `0` disables a scope's limit entirely.
 *
 * Mirrors the two-layer pattern of ./rate-limit and ./caller-validation-cache:
 * a per-isolate in-memory map (cheap, synchronous) plus a durable colo-wide
 * entry in the Workers Cache API, absent under vitest/Node where the in-memory
 * layer alone applies. Increments are read-modify-write, not atomic across
 * isolates, so a burst can slightly overshoot the limit — acceptable for an
 * abuse brake (same best-effort stance as the backoff window).
 */

export type InboundRateLimitScope = 'auth' | 'search' | 'mcp'

const DEFAULT_INBOUND_WINDOW_SECONDS = 60

/** Max requests per window per caller. Auth is stricter: it is unauthenticated. */
const DEFAULT_INBOUND_LIMITS: Record<InboundRateLimitScope, number> = {
  auth: 10,
  search: 30,
  mcp: 60
}

type WindowState = { count: number; resetAtMs: number }

// In-memory mirror: `${scope}/${callerKey}` -> current fixed window.
const windowsByBucket = new Map<string, WindowState>()

const bucketCacheKey = (bucket: string): string =>
  `https://inbound-rate-limit.tiny.nntin.xyz/${bucket}`
const COUNT_HEADER = 'x-inbound-rate-count'
const RESET_AT_HEADER = 'x-inbound-rate-reset-at'

const cacheStore = (): Cache | undefined =>
  (globalThis as { caches?: { default?: Cache } }).caches?.default

const readDurableWindow = async (
  bucket: string
): Promise<WindowState | undefined> => {
  const store = cacheStore()
  if (!store) return undefined
  try {
    const hit = await store.match(bucketCacheKey(bucket))
    if (!hit) return undefined
    const count = Number(hit.headers.get(COUNT_HEADER) ?? '0')
    const resetAtMs = Number(hit.headers.get(RESET_AT_HEADER) ?? '0')
    if (!Number.isFinite(count) || !Number.isFinite(resetAtMs)) return undefined
    return { count, resetAtMs }
  } catch {
    // A malformed cache entry must never break the request — count in memory only.
    return undefined
  }
}

const writeDurableWindow = async (
  bucket: string,
  window: WindowState,
  nowMs: number
): Promise<void> => {
  const store = cacheStore()
  if (!store) return
  try {
    const response = new Response('', {
      headers: {
        // Auto-evict the entry once the window elapses.
        'cache-control': `max-age=${Math.max(1, Math.ceil((window.resetAtMs - nowMs) / 1000))}`,
        [COUNT_HEADER]: String(window.count),
        [RESET_AT_HEADER]: String(window.resetAtMs)
      }
    })
    await store.put(bucketCacheKey(bucket), response)
  } catch {
    // Best-effort: a write failure just means another isolate undercounts.
  }
}

export type InboundRateLimitResult =
  | { limited: false }
  | { limited: true; retryAfterMs: number }

/**
 * Count one request against the caller's fixed window and report whether it is
 * over the limit. Reads the durable window on an in-memory miss (so a fresh
 * isolate honours counts accumulated elsewhere in the colo) and writes every
 * increment back, best-effort.
 */
export const checkInboundRateLimit = async (
  scope: InboundRateLimitScope,
  callerKey: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now()
): Promise<InboundRateLimitResult> => {
  const bucket = `${scope}/${callerKey}`

  let window = windowsByBucket.get(bucket)
  if (window && window.resetAtMs <= nowMs) window = undefined
  if (!window) {
    const durable = await readDurableWindow(bucket)
    if (durable && durable.resetAtMs > nowMs) window = durable
  }

  if (window && window.count >= limit) {
    // Over the limit: report the remaining window without counting the request,
    // so a rejected burst does not extend its own punishment.
    windowsByBucket.set(bucket, window)
    return { limited: true, retryAfterMs: window.resetAtMs - nowMs }
  }

  const next: WindowState = window
    ? { count: window.count + 1, resetAtMs: window.resetAtMs }
    : { count: 1, resetAtMs: nowMs + windowMs }
  windowsByBucket.set(bucket, next)
  await writeDurableWindow(bucket, next, nowMs)
  return { limited: false }
}

/** Reset the in-memory windows (tests only — module state leaks across cases). */
export const clearInboundRateLimits = (): void => {
  windowsByBucket.clear()
}

/** A positive integer from a binding, the fallback otherwise. `'0'` is kept: it means "disabled". */
const parseLimitBinding = (
  raw: string | undefined,
  fallback: number
): number => {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) return fallback
  return value
}

const LIMIT_BINDINGS: Record<
  InboundRateLimitScope,
  (env: Bindings) => string | undefined
> = {
  auth: (env) => env.RATE_LIMIT_AUTH_MAX,
  search: (env) => env.RATE_LIMIT_SEARCH_MAX,
  mcp: (env) => env.RATE_LIMIT_MCP_MAX
}

/**
 * Bucket the caller: per credential when an Authorization header is present,
 * per client IP otherwise. Both are hashed; callers the edge cannot tell apart
 * (no credential AND no cf-connecting-ip, e.g. vitest) share one bucket —
 * throttled together rather than not at all.
 */
const deriveCallerKey = async (req: {
  header: (name: string) => string | undefined
}): Promise<string> => {
  const authorization = req.header('authorization') ?? req.header('Authorization')
  if (authorization) return deriveCredentialKey(authorization)
  const ip = req.header('cf-connecting-ip')
  if (!ip) return SHARED_CREDENTIAL_KEY
  return deriveCredentialKey(`ip:${ip}`)
}

/**
 * Hono middleware enforcing the inbound limit for one scope. Registered per
 * route in index.ts, ahead of the handlers (and their request validation), so
 * even malformed floods are throttled.
 */
export const inboundRateLimit = (
  scope: InboundRateLimitScope
): MiddlewareHandler<{ Bindings: Bindings }> => {
  return async (c, next) => {
    // CORS preflights are answered by the cors middleware and carry no payload —
    // they must not eat into the caller's budget.
    if (c.req.method === 'OPTIONS') return next()

    const limit = parseLimitBinding(
      LIMIT_BINDINGS[scope](c.env),
      DEFAULT_INBOUND_LIMITS[scope]
    )
    if (limit === 0) return next()

    const windowSeconds = parseLimitBinding(
      c.env.RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_INBOUND_WINDOW_SECONDS
    )
    const windowMs =
      (windowSeconds > 0 ? windowSeconds : DEFAULT_INBOUND_WINDOW_SECONDS) * 1000

    const callerKey = await deriveCallerKey(c.req)
    const result = await checkInboundRateLimit(scope, callerKey, limit, windowMs)
    if (result.limited) {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Too many requests' }),
        429,
        { 'retry-after': String(retryAfterSeconds) }
      )
    }
    await next()
  }
}
