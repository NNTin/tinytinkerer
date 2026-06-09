import type { OpenAPIHono } from '@hono/zod-openapi'
import {
  EDGE_RATE_LIMIT_HEADERS,
  edgeErrorResponseSchema,
  modelEntrySchema,
  modelsChatResponseSchema,
  type ModelEntry,
  type ModelProviderId
} from '@tinytinkerer/contracts'
import { z } from 'zod'
import { captureTelemetryMessage } from '@tinytinkerer/sentry-telemetry'
import type { Bindings } from '../lib/bindings'
import { applyCorsHeaders } from '../lib/cors'
import { modelsChatRoute, modelsListRoute } from '../openapi/routes'
import { fetchWithTimeout } from '../lib/fetch'
import {
  isFresh,
  readCachedModels,
  writeCachedModels
} from '../lib/models-cache'
import {
  clearBackoff,
  deriveCredentialKey,
  getActiveBackoffMs,
  rateLimitResponseFromMs,
  recordBackoff,
  toRateLimitResponse
} from '../lib/rate-limit'

const liteLLMModelsCatalogEntrySchema = z
  .object({
    id: z.string(),
    object: z.string().optional(),
    owned_by: z.string().optional()
  })
  .passthrough()

const liteLLMModelsCatalogSchema = z.object({
  data: z.array(liteLLMModelsCatalogEntrySchema)
})

// api.github.com (the core REST API) rejects requests without a User-Agent with
// a 403 ("Request forbidden by administrative rules ... User-Agent header
// required"). Cloudflare Workers' `fetch` does not set one, so the LiteLLM
// caller-validation probe below must send it explicitly or EVERY call 403s and
// is mis-read as an invalid caller -> a spurious 401 (TINYTINKERER-FRONTEND-N/P/Q/R).
const GITHUB_API_USER_AGENT = 'tinytinkerer-edge'
const LITELLM_DEFAULT_BASE_URL = 'https://litellm.labs.lair.nntin.xyz/'
const LITELLM_DEFAULT_MODEL = 'openai/gpt-5'

const UPSTREAM_ERROR_MESSAGES: Partial<Record<number, string>> = {
  400: 'Invalid request',
  401: 'Authentication failed. The configured LiteLLM virtual key may be invalid.',
  403: 'Access denied. Check the configured LiteLLM virtual key permissions.',
  422: 'Unprocessable request',
  500: 'Upstream service error',
  503: 'Upstream service unavailable',
  504: 'Upstream service timed out'
}

const UPSTREAM_ERROR_STATUSES = new Set([400, 401, 403, 422, 500, 503, 504])
const MAX_UPSTREAM_ERROR_MESSAGE_LENGTH = 500

type LiteLLMBaseUrlResult =
  | { ok: true; baseUrl: string }
  | { ok: false; error: string }

type LiteLLMCallerValidationResult = 'valid' | 'invalid' | 'unavailable'

const normalizeLiteLLMBaseUrl = (
  value: string | null | undefined
): string | undefined => {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  try {
    const url = new URL(trimmed)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    return url.href.replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

const configuredLiteLLMBaseUrl = (env: Bindings): string =>
  normalizeLiteLLMBaseUrl(env.LITELLM_BASE_URL) ??
  normalizeLiteLLMBaseUrl(LITELLM_DEFAULT_BASE_URL) ??
  LITELLM_DEFAULT_BASE_URL.replace(/\/+$/, '')

const configuredLiteLLMAllowedBaseUrls = (env: Bindings): Set<string> => {
  const urls = new Set<string>([configuredLiteLLMBaseUrl(env)])
  for (const rawUrl of env.LITELLM_ALLOWED_BASE_URLS?.split(',') ?? []) {
    const normalized = normalizeLiteLLMBaseUrl(rawUrl)
    if (normalized) urls.add(normalized)
  }
  return urls
}

const resolveLiteLLMBaseUrl = (
  env: Bindings,
  requestedBaseUrl: string | null | undefined
): LiteLLMBaseUrlResult => {
  const baseUrl = requestedBaseUrl
    ? normalizeLiteLLMBaseUrl(requestedBaseUrl)
    : configuredLiteLLMBaseUrl(env)
  if (!baseUrl) {
    return { ok: false, error: 'Invalid LiteLLM base URL' }
  }
  if (!configuredLiteLLMAllowedBaseUrls(env).has(baseUrl)) {
    return { ok: false, error: 'LiteLLM base URL is not allowed' }
  }
  return { ok: true, baseUrl }
}

const appendPath = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`

const litellmChatUrl = (baseUrl: string): string =>
  appendPath(baseUrl, '/v1/chat/completions')

const litellmListUrl = (baseUrl: string): string =>
  appendPath(baseUrl, '/v1/models')

const litellmHeaders = (env: Bindings): Record<string, string> => ({
  authorization: `Bearer ${env.LITELLM_API_KEY?.trim() ?? ''}`
})

const textValue = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const extractUpstreamErrorMessage = (rawText: string): string | undefined => {
  const raw = rawText.trim()
  if (!raw) return undefined

  try {
    const body = JSON.parse(raw) as unknown
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>
      const nestedError = record.error
      if (typeof nestedError === 'object' && nestedError !== null) {
        const errorRecord = nestedError as Record<string, unknown>
        const nestedMessage =
          textValue(errorRecord.message) ?? textValue(errorRecord.detail)
        if (nestedMessage) return nestedMessage
      }
      const message =
        textValue(record.error) ??
        textValue(record.message) ??
        textValue(record.detail)
      if (message) return message
    }
  } catch {
    const message = textValue(raw)
    if (message) return message
  }

  return undefined
}

const safeUpstreamError = (rawText: string, fallback: string): string => {
  const message = extractUpstreamErrorMessage(rawText) ?? fallback
  return message.length > MAX_UPSTREAM_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_UPSTREAM_ERROR_MESSAGE_LENGTH - 3)}...`
    : message
}

const liteLLMCacheScope = (baseUrl: string): string =>
  encodeURIComponent(baseUrl)

const liteLLMSharedCredentialKeyInput = (
  env: Bindings,
  baseUrl: string
): string => `litellm:${env.LITELLM_API_KEY ?? ''}:${baseUrl}`

const requireLiteLLMConfiguration = (env: Bindings): string | undefined => {
  const apiKey = env.LITELLM_API_KEY?.trim()
  return apiKey ? undefined : 'LiteLLM is not configured.'
}

const validateLiteLLMCaller = async (
  authorization: string
): Promise<LiteLLMCallerValidationResult> => {
  const response = await fetchWithTimeout(
    {
      area: 'models.litellm.auth',
      origin: 'github',
      method: 'GET',
      url: 'https://api.github.com/user',
      accept: {
        status: [401, 403],
        reason:
          'Expected GitHub token rejection while validating a caller before using the shared LiteLLM key.'
      }
    },
    {
      headers: {
        authorization,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10',
        'user-agent': GITHUB_API_USER_AGENT
      }
    },
    10_000
  ).catch(() => undefined)

  if (!response) return 'unavailable'
  if (response.ok) return 'valid'
  if (response.status === 401 || response.status === 403) return 'invalid'
  return 'unavailable'
}

const toLiteLLMModels = (raw: unknown): ModelEntry[] => {
  const parsed = liteLLMModelsCatalogSchema.safeParse(raw)
  const entries = parsed.success ? parsed.data.data : []
  return entries.flatMap((model) => {
    const id = model.id.trim()
    if (!id || id.toLowerCase().includes('embedding')) return []
    const publisher = id.includes('/') ? id.split('/')[0] : model.owned_by
    return [
      modelEntrySchema.parse({
        provider: 'litellm',
        id,
        label: id,
        kind: 'chat',
        ...(publisher ? { publisher } : {})
      })
    ]
  })
}

// Sentinel recorded on telemetry when the client omitted the provider field, so
// a misbehaving client is surfaced rather than dropped.
const ABSENT_PROVIDER = 'absent'

// A request without an explicit provider is silently served by LiteLLM (the
// sole provider). That hides a misbehaving client, so surface it as a Sentry
// message tagged with the area and the provider we fell back to. Returns the
// value to stamp on request telemetry: the requested provider id, or the
// ABSENT sentinel.
const trackRequestedProvider = (
  area: 'models.chat' | 'models.list',
  requested: ModelProviderId | undefined
): string => {
  if (requested !== undefined) return requested
  captureTelemetryMessage(
    `${area} request omitted the provider field; defaulting to litellm`,
    {
      level: 'warning',
      tags: {
        request_area: area,
        request_provider: ABSENT_PROVIDER,
        provider_missing: true,
        resolved_provider: 'litellm'
      },
      contexts: {
        request: { area, provider_missing: true, resolved_provider: 'litellm' }
      },
      fingerprint: ['models-provider-missing', area]
    }
  )
  return ABSENT_PROVIDER
}

export const registerModelRoutes = (
  app: OpenAPIHono<{ Bindings: Bindings }>
) => {
  app.openapi(modelsChatRoute, async (c) => {
    const body = c.req.valid('json')
    const authorization =
      c.req.header('authorization') ?? c.req.header('Authorization')

    if (!authorization) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Unauthorized' }),
        401
      )
    }

    const useStream = body.stream === true
    const telemetryProvider = trackRequestedProvider(
      'models.chat',
      body.provider
    )
    const litellmBaseUrl = resolveLiteLLMBaseUrl(c.env, body.litellmBaseUrl)
    if (!litellmBaseUrl.ok) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: litellmBaseUrl.error }),
        400
      )
    }
    const configurationError = requireLiteLLMConfiguration(c.env)
    if (configurationError) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: configurationError }),
        503
      )
    }
    const callerValidation = await validateLiteLLMCaller(authorization)
    if (callerValidation === 'invalid') {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Unauthorized' }),
        401
      )
    }
    if (callerValidation === 'unavailable') {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'LiteLLM caller validation is temporarily unavailable.'
        }),
        503
      )
    }
    const resolvedBaseUrl = litellmBaseUrl.baseUrl
    const model = body.model ?? LITELLM_DEFAULT_MODEL

    // Scope the backoff to the upstream credential/quota bucket: the shared
    // edge-managed key (plus base URL) so one caller's 429 correctly backs off
    // all callers of the same LiteLLM deployment.
    const credentialKey = await deriveCredentialKey(
      liteLLMSharedCredentialKeyInput(c.env, resolvedBaseUrl)
    )

    // Respect a still-open upstream rate-limit window (durable across isolates):
    // short-circuit with a 429 instead of re-hammering the upstream provider
    // (TINYTINKERER-EDGE-4).
    const backoffMs = await getActiveBackoffMs(Date.now(), credentialKey)
    if (backoffMs > 0) {
      c.header('Retry-After', String(Math.ceil(backoffMs / 1000)))
      return c.json(rateLimitResponseFromMs(backoffMs), 429)
    }

    const response = await fetchWithTimeout(
      {
        area: 'models.chat',
        origin: 'litellm',
        method: 'POST',
        url: litellmChatUrl(resolvedBaseUrl),
        model,
        provider: telemetryProvider,
        stream: useStream,
        // Chat completions are NOT cacheable, so after we durably honour the
        // upstream rate-limit window (above) the residual 429 — the first call
        // that opens a new window — is a user-triggered, unavoidable provider
        // rate limit. The frontend surfaces it as a cooldown; capturing
        // it adds no signal (TINYTINKERER-EDGE-4 / FRONTEND-9).
        //
        // `abort` is also accepted here: this chat fetch is wired to the client's
        // request signal (below), so an abort means the browser/runtime cancelled
        // the in-flight stream — its step idle-timeout fired or the user stopped
        // the run — or our own backstop timeout tripped on a slow reasoning model.
        // That is expected control flow, not an edge bug, mirroring the frontend
        // call sites that already accept abort (edge-fetch.ts / synthesize)
        // (TINYTINKERER-EDGE-7).
        accept: {
          kinds: ['abort'],
          status: [429],
          reason:
            'LiteLLM chat rate limit; honoured via durable backoff + clean 429/Retry-After, surfaced to the user as a cooldown (TINYTINKERER-EDGE-4). abort = client cancelled the stream / backstop timeout on a slow reasoning model (TINYTINKERER-EDGE-7).'
        }
      },
      {
        method: 'POST',
        headers: {
          ...litellmHeaders(c.env),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages: body.messages,
          stream: useStream
        }),
        // Stop hammering the upstream as soon as the client disconnects instead
        // of keeping a doomed request alive until the backstop timeout fires
        // (TINYTINKERER-EDGE-7). fetchWithTimeout composes this with its timeout.
        signal: c.req.raw.signal
      },
      // Backstop only. Slow reasoning models (e.g. openai/gpt-5 via LiteLLM) can
      // take well over 30s to first byte; the frontend's first-token budget is
      // the user-facing authority, so keep this comfortably above it so the edge
      // is not the one that prematurely aborts a healthy stream (FRONTEND-S).
      120_000
    )

    if (!response.ok) {
      const rawText = await response.text()
      console.error('[models/chat] upstream error', {
        status: response.status,
        'retry-after': response.headers.get('retry-after'),
        'x-ratelimit-limit-requests': response.headers.get(
          'x-ratelimit-limit-requests'
        ),
        'x-ratelimit-remaining-requests': response.headers.get(
          'x-ratelimit-remaining-requests'
        ),
        'x-ratelimit-reset-requests': response.headers.get(
          'x-ratelimit-reset-requests'
        )
      })

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const rateLimitBody = toRateLimitResponse(rawText, retryAfter)
        // Remember the window (durably, colo-wide) so the next call backs off
        // instead of re-probing.
        await recordBackoff(
          rateLimitBody.retryAfterMs,
          Date.now(),
          credentialKey
        )
        c.header(
          'Retry-After',
          retryAfter ?? String(Math.ceil(rateLimitBody.retryAfterMs / 1000))
        )
        for (const header of EDGE_RATE_LIMIT_HEADERS) {
          const value = response.headers.get(header)
          if (value !== null) c.header(header, value)
        }
        return c.json(rateLimitBody, 429)
      }

      if (response.status === 503) {
        const retryAfter = response.headers.get('retry-after')
        if (retryAfter) c.header('Retry-After', retryAfter)
      }

      const fallbackError =
        UPSTREAM_ERROR_MESSAGES[response.status] ??
        `Upstream error ${response.status}`
      const safeError =
        response.status === 400 || response.status === 422
          ? safeUpstreamError(rawText, fallbackError)
          : fallbackError
      const statusCode = UPSTREAM_ERROR_STATUSES.has(response.status)
        ? (response.status as 400 | 401 | 403 | 422 | 500 | 503 | 504)
        : 502
      return c.json(
        edgeErrorResponseSchema.parse({ error: safeError }),
        statusCode
      )
    }

    // Upstream accepted the request — clear any backoff window.
    await clearBackoff(credentialKey)

    if (useStream && response.body) {
      const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no'
      })

      for (const header of EDGE_RATE_LIMIT_HEADERS) {
        const value = response.headers.get(header)
        if (value !== null) headers.set(header, value)
      }

      applyCorsHeaders(headers, c.env, c.req.header('origin') ?? null)

      return new Response(response.body, {
        status: 200,
        headers
      })
    }

    for (const header of EDGE_RATE_LIMIT_HEADERS) {
      const value = response.headers.get(header)
      if (value !== null) c.header(header, value)
    }

    const rawText = await response.text()
    return c.json(modelsChatResponseSchema.parse(JSON.parse(rawText)), 200)
  })

  app.openapi(modelsListRoute, async (c) => {
    const authorization =
      c.req.header('authorization') ?? c.req.header('Authorization')

    if (!authorization) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Unauthorized' }),
        401
      )
    }

    const query = c.req.valid('query')
    const telemetryProvider = trackRequestedProvider(
      'models.list',
      query.provider
    )
    const litellmBaseUrl = resolveLiteLLMBaseUrl(c.env, query.litellmBaseUrl)
    if (!litellmBaseUrl.ok) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: litellmBaseUrl.error }),
        400
      )
    }
    const configurationError = requireLiteLLMConfiguration(c.env)
    if (configurationError) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: configurationError }),
        503
      )
    }
    const callerValidation = await validateLiteLLMCaller(authorization)
    if (callerValidation === 'invalid') {
      return c.json(
        edgeErrorResponseSchema.parse({ error: 'Unauthorized' }),
        401
      )
    }
    if (callerValidation === 'unavailable') {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'LiteLLM caller validation is temporarily unavailable.'
        }),
        503
      )
    }
    const resolvedBaseUrl = litellmBaseUrl.baseUrl
    const listUrl = litellmListUrl(resolvedBaseUrl)
    const cacheScope = liteLLMCacheScope(resolvedBaseUrl)

    // Scope the backoff to the upstream credential/quota bucket (issue #146):
    // the shared edge-managed key plus base URL, so one caller's 429 backs off
    // all callers of the same LiteLLM deployment.
    const credentialKey = await deriveCredentialKey(
      liteLLMSharedCredentialKeyInput(c.env, resolvedBaseUrl)
    )

    // The catalogue rarely changes and is identical for every caller. Serve a
    // fresh cached copy without touching upstream — this is what actually stops
    // us re-probing the upstream provider on every request and tripping its rate limit
    // (TINYTINKERER-EDGE-4 / FRONTEND-5). The reactive backoff below is only a
    // secondary guard; the per-isolate version shipped in PR #100 reset on every
    // fresh Cloudflare isolate, which is why the 429s regressed.
    const cached = await readCachedModels(Date.now(), cacheScope)
    if (cached && isFresh(cached.ageMs)) {
      return c.json({ models: cached.models }, 200)
    }

    // Honor a still-open rate-limit window shared with the chat route for this
    // credential (durable across isolates). Prefer the last-known catalogue over
    // cascading anything.
    const backoffMs = await getActiveBackoffMs(Date.now(), credentialKey)
    if (backoffMs > 0) {
      if (cached) return c.json({ models: cached.models }, 200)
      // No cached catalogue yet but a window is open: emit the SAME single
      // cooldown signal as the cold-cache-miss path below — a graceful 503 +
      // Retry-After — instead of leaking the raw upstream 429. The browser is not
      // itself rate limited; one status keeps the frontend contract for this
      // cacheable catalogue simple: serve last-known and retry later
      // (TINYTINKERER-FRONTEND-C / FRONTEND-D).
      c.header('Retry-After', String(Math.ceil(backoffMs / 1000)))
      return c.json(
        edgeErrorResponseSchema.parse({ error: UPSTREAM_ERROR_MESSAGES[503] }),
        503
      )
    }

    const response = await fetchWithTimeout(
      {
        area: 'models.list',
        origin: 'litellm',
        method: 'GET',
        url: listUrl,
        provider: telemetryProvider,
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
            'Cold-cache-miss window-opener: the one unavoidable probe of the LiteLLM catalogue on a fresh isolate; cache + durable backoff handle the rest and we serve last-known / 503 instead of re-probing (TINYTINKERER-EDGE-5).'
        }
      },
      {
        headers: litellmHeaders(c.env)
      },
      10_000
    )

    if (!response.ok) {
      console.error('[models/list] upstream error', {
        status: response.status,
        url: listUrl
      })

      // A rate limit is not a gateway failure: record the backoff window and,
      // when we have a previously cached catalogue, serve it instead of
      // cascading the 429 downstream (TINYTINKERER-FRONTEND-5). With nothing
      // cached, fall back to the single 503 cooldown signal (below) — never a raw
      // 429 — so the browser contract for this cacheable catalogue is one status
      // (TINYTINKERER-FRONTEND-C / FRONTEND-D).
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after')
        const rateLimitBody = toRateLimitResponse(
          await response.text(),
          retryAfter
        )
        // Remember the window durably (colo-wide) so the next request — in any
        // isolate — backs off instead of re-probing.
        await recordBackoff(
          rateLimitBody.retryAfterMs,
          Date.now(),
          credentialKey
        )
        // Prefer the last-known catalogue over cascading the upstream 429.
        if (cached) return c.json({ models: cached.models }, 200)
        // Cold-cache miss (fresh isolate, nothing cached yet): the catalogue is
        // temporarily unavailable — the browser is not itself rate limited, so a
        // 429 would be misleading. Surface a graceful 503 + Retry-After; the client
        // falls back to its built-in model list and retries later, and the durable
        // backoff already recorded above stops us re-probing the provider in the
        // meantime (TINYTINKERER-EDGE-5).
        c.header(
          'Retry-After',
          retryAfter ?? String(Math.ceil(rateLimitBody.retryAfterMs / 1000))
        )
        return c.json(
          edgeErrorResponseSchema.parse({
            error: UPSTREAM_ERROR_MESSAGES[503]
          }),
          503
        )
      }

      const safeError =
        UPSTREAM_ERROR_MESSAGES[response.status] ??
        `Upstream error ${response.status}`
      const statusCode = UPSTREAM_ERROR_STATUSES.has(response.status)
        ? (response.status as 400 | 401 | 403 | 422 | 500 | 503 | 504)
        : 502
      return c.json(
        edgeErrorResponseSchema.parse({ error: safeError }),
        statusCode
      )
    }

    // Upstream succeeded — clear any backoff window.
    await clearBackoff(credentialKey)

    const models = toLiteLLMModels(await response.json())

    // Populate the colo-wide cache so the next request (in any isolate) skips
    // the upstream fetch for the freshness window.
    await writeCachedModels(models, Date.now(), cacheScope)

    return c.json({ models }, 200)
  })
}
