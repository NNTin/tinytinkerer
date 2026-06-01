import { zValidator } from '@hono/zod-validator'
import {
  edgeErrorResponseSchema,
  modelsChatRequestSchema,
  modelsChatResponseSchema
} from '@tinytinkerer/contracts'
import { z } from 'zod'
import type { Hono } from 'hono'
import type { Bindings } from '../lib/bindings'
import { applyCorsHeaders } from '../lib/cors'
import { fetchWithTimeout } from '../lib/fetch'
import { isFresh, readCachedModels, writeCachedModels } from '../lib/models-cache'
import {
  clearBackoff,
  getActiveBackoffMs,
  rateLimitResponseFromMs,
  recordBackoff,
  toRateLimitResponse
} from '../lib/rate-limit'

const githubModelsListSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    name: z.string().optional()
  })).optional()
})

const RATE_LIMIT_HEADERS = [
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-renewalperiod-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
  'x-ratelimit-renewalperiod-tokens',
  'x-ratelimit-abusepenalty-active',
] as const

const GITHUB_MODELS_DEFAULT_URL = 'https://models.github.ai/inference'
const GITHUB_MODELS_LIST_URL = 'https://models.github.ai/v1/models'

const UPSTREAM_ERROR_MESSAGES: Partial<Record<number, string>> = {
  400: 'Invalid request',
  401: 'Authentication failed. Your GitHub token may be invalid or expired.',
  403: 'Access denied. Check your GitHub token permissions.',
  422: 'Unprocessable request',
  500: 'Upstream service error',
  503: 'Upstream service unavailable',
  504: 'Upstream service timed out'
}

const UPSTREAM_ERROR_STATUSES = new Set([400, 401, 403, 422, 500, 503, 504])

export const registerModelRoutes = (app: Hono<{ Bindings: Bindings }>) => {
  app.post('/api/models/chat', zValidator('json', modelsChatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')

    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }

    const useStream = body.stream === true
    const modelsBaseUrl = c.env.GITHUB_MODELS_URL ?? GITHUB_MODELS_DEFAULT_URL

    // Respect a still-open upstream rate-limit window (durable across isolates):
    // short-circuit with a 429 instead of re-hammering GitHub Models
    // (TINYTINKERER-EDGE-4).
    const backoffMs = await getActiveBackoffMs()
    if (backoffMs > 0) {
      c.header('Retry-After', String(Math.ceil(backoffMs / 1000)))
      return c.json(rateLimitResponseFromMs(backoffMs), 429)
    }

    const response = await fetchWithTimeout(
      {
        area: 'models.chat',
        origin: 'github',
        method: 'POST',
        url: `${modelsBaseUrl}/chat/completions`,
        stream: useStream,
        // Chat completions are NOT cacheable, so after we durably honour the
        // upstream rate-limit window (above) the residual 429 — the first call
        // that opens a new window — is a user-triggered, unavoidable GitHub
        // Models rate limit. The frontend surfaces it as a cooldown; capturing
        // it adds no signal (TINYTINKERER-EDGE-4 / FRONTEND-9).
        accept: {
          status: [429],
          reason:
            'GitHub Models chat rate limit; honoured via durable backoff + clean 429/Retry-After, surfaced to the user as a cooldown (TINYTINKERER-EDGE-4).'
        }
      },
      {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: body.model ?? 'openai/gpt-4.1-mini',
          messages: body.messages,
          stream: useStream
        })
      },
      30_000
    )

    if (!response.ok) {
      const rawText = await response.text()
      console.error('[models/chat] upstream error', {
        status: response.status,
        'retry-after': response.headers.get('retry-after'),
        'x-ratelimit-limit-requests': response.headers.get('x-ratelimit-limit-requests'),
        'x-ratelimit-remaining-requests': response.headers.get('x-ratelimit-remaining-requests'),
        'x-ratelimit-reset-requests': response.headers.get('x-ratelimit-reset-requests')
      })

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const rateLimitBody = toRateLimitResponse(rawText, retryAfter)
        // Remember the window (durably, colo-wide) so the next call backs off
        // instead of re-probing.
        await recordBackoff(rateLimitBody.retryAfterMs)
        c.header('Retry-After', retryAfter ?? String(Math.ceil(rateLimitBody.retryAfterMs / 1000)))
        for (const header of RATE_LIMIT_HEADERS) {
          const value = response.headers.get(header)
          if (value !== null) c.header(header, value)
        }
        return c.json(rateLimitBody, 429)
      }

      if (response.status === 503) {
        const retryAfter = response.headers.get('retry-after')
        if (retryAfter) c.header('Retry-After', retryAfter)
      }

      const safeError =
        UPSTREAM_ERROR_MESSAGES[response.status] ?? `Upstream error ${response.status}`
      const statusCode = UPSTREAM_ERROR_STATUSES.has(response.status)
        ? (response.status as 400 | 401 | 403 | 422 | 500 | 503 | 504)
        : 502
      return c.json(edgeErrorResponseSchema.parse({ error: safeError }), statusCode)
    }

    // Upstream accepted the request — clear any backoff window.
    await clearBackoff()

    if (useStream && response.body) {
      const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      })

      for (const header of RATE_LIMIT_HEADERS) {
        const value = response.headers.get(header)
        if (value !== null) headers.set(header, value)
      }

      applyCorsHeaders(headers, c.env, c.req.header('origin') ?? null)

      return new Response(response.body, {
        status: 200,
        headers
      })
    }

    for (const header of RATE_LIMIT_HEADERS) {
      const value = response.headers.get(header)
      if (value !== null) c.header(header, value)
    }

    const rawText = await response.text()
    return c.json(modelsChatResponseSchema.parse(JSON.parse(rawText)), 200)
  })

  app.get('/api/models/list', async (c) => {
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')

    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }

    const listUrl = c.env.GITHUB_MODELS_URL
      ? `${c.env.GITHUB_MODELS_URL}/models`
      : GITHUB_MODELS_LIST_URL

    // The catalogue rarely changes and is identical for every caller. Serve a
    // fresh cached copy without touching upstream — this is what actually stops
    // us re-probing GitHub Models on every request and tripping its rate limit
    // (TINYTINKERER-EDGE-4 / FRONTEND-5). The reactive backoff below is only a
    // secondary guard; the per-isolate version shipped in PR #100 reset on every
    // fresh Cloudflare isolate, which is why the 429s regressed.
    const cached = await readCachedModels()
    if (cached && isFresh(cached.ageMs)) {
      return c.json({ models: cached.models })
    }

    // Honor a still-open rate-limit window shared with the chat route (durable
    // across isolates). Prefer the last-known catalogue over cascading anything.
    const backoffMs = await getActiveBackoffMs()
    if (backoffMs > 0) {
      if (cached) return c.json({ models: cached.models })
      // No cached catalogue yet but a window is open: emit the SAME single
      // cooldown signal as the cold-cache-miss path below — a graceful 503 +
      // Retry-After — instead of leaking the raw upstream 429. The browser is not
      // itself rate limited; one status keeps the frontend contract for this
      // cacheable catalogue simple: serve last-known and retry later
      // (TINYTINKERER-FRONTEND-C / FRONTEND-D).
      c.header('Retry-After', String(Math.ceil(backoffMs / 1000)))
      return c.json(edgeErrorResponseSchema.parse({ error: UPSTREAM_ERROR_MESSAGES[503] }), 503)
    }

    const response = await fetchWithTimeout(
      {
        area: 'models.list',
        origin: 'github',
        method: 'GET',
        url: listUrl,
        // models.list IS cacheable, so the catalogue cache + durable backoff above
        // are the real fix — we only reach this upstream fetch on a cache miss with
        // no active backoff window. A 429 here is therefore the cold-cache-miss
        // window-opener: the one unavoidable probe on a fresh isolate / empty Cache
        // API right after a deploy, the cacheable analogue of the non-cacheable
        // window-opener. We record the backoff below and serve last-known / a 503
        // instead of re-probing, so capturing this first probe adds no signal. This
        // is NOT a blanket accept of the cacheable 429 — the caching machinery does
        // the work; only the cold-start opener is accepted (TINYTINKERER-EDGE-5).
        accept: {
          status: [429],
          reason:
            'Cold-cache-miss window-opener: the one unavoidable probe of the GitHub Models catalogue on a fresh isolate; cache + durable backoff handle the rest and we serve last-known / 503 instead of re-probing (TINYTINKERER-EDGE-5).'
        }
      },
      { headers: { authorization, accept: 'application/json' } },
      10_000
    )

    if (!response.ok) {
      console.error('[models/list] upstream error', { status: response.status, url: listUrl })

      // A rate limit is not a gateway failure: record the backoff window and,
      // when we have a previously cached catalogue, serve it instead of
      // cascading the 429 downstream (TINYTINKERER-FRONTEND-5). With nothing
      // cached, fall back to the single 503 cooldown signal (below) — never a raw
      // 429 — so the browser contract for this cacheable catalogue is one status
      // (TINYTINKERER-FRONTEND-C / FRONTEND-D).
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const rateLimitBody = toRateLimitResponse(await response.text(), retryAfter)
        // Remember the window durably (colo-wide) so the next request — in any
        // isolate — backs off instead of re-probing.
        await recordBackoff(rateLimitBody.retryAfterMs)
        // Prefer the last-known catalogue over cascading the upstream 429.
        if (cached) return c.json({ models: cached.models })
        // Cold-cache miss (fresh isolate, nothing cached yet): the catalogue is
        // temporarily unavailable — the browser is not itself rate limited, so a
        // 429 would be misleading. Surface a graceful 503 + Retry-After; the client
        // falls back to its built-in model list and retries later, and the durable
        // backoff already recorded above stops us re-probing GitHub Models in the
        // meantime (TINYTINKERER-EDGE-5).
        c.header('Retry-After', retryAfter ?? String(Math.ceil(rateLimitBody.retryAfterMs / 1000)))
        return c.json(
          edgeErrorResponseSchema.parse({ error: UPSTREAM_ERROR_MESSAGES[503] }),
          503
        )
      }

      const safeError =
        UPSTREAM_ERROR_MESSAGES[response.status] ?? `Upstream error ${response.status}`
      const statusCode = UPSTREAM_ERROR_STATUSES.has(response.status)
        ? (response.status as 400 | 401 | 403 | 422 | 500 | 503 | 504)
        : 502
      return c.json(edgeErrorResponseSchema.parse({ error: safeError }), statusCode)
    }

    // Upstream succeeded — clear any backoff window.
    await clearBackoff()

    const parsed = githubModelsListSchema.safeParse(await response.json())
    const models = (parsed.success ? (parsed.data.data ?? []) : []).map((m) => ({
      id: m.id,
      label: m.name ?? m.id
    }))

    // Populate the colo-wide cache so the next request (in any isolate) skips
    // the upstream fetch for the freshness window.
    await writeCachedModels(models)

    return c.json({ models })
  })
}
