import type { OpenAPIHono } from '@hono/zod-openapi'
import {
  DEFAULT_LITELLM_MODEL,
  EDGE_RATE_LIMIT_HEADERS,
  edgeErrorResponseSchema,
  modelEntrySchema,
  modelsChatResponseSchema,
  type ModelEntry,
  type ModelProviderId,
  validateLiteLLMBaseUrlPolicy
} from '@tinytinkerer/contracts'
import { z } from 'zod'
import type { Context, TypedResponse } from 'hono'
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
  getActiveBackoffMs,
  rateLimitResponseFromMs,
  recordBackoff,
  toRateLimitResponse,
  type CredentialKey
} from '../lib/rate-limit'
import {
  validateLiteLLMCaller,
  type CallerIdentity
} from '../lib/caller-validation'
import {
  ANONYMOUS_IDENTITY,
  clearLiteLLMUserKeyCache,
  deriveAnonymousCredentialKey,
  deriveLiteLLMUserCredentialKey,
  requireLiteLLMUserKeyConfiguration,
  resolveAnonymousLiteLLMKey,
  resolveLiteLLMUserKey,
  type LiteLLMUserKey
} from '../lib/litellm-user-keys'

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

const liteLLMModelInfoEntrySchema = z
  .object({
    model_name: z.string(),
    model_info: z
      .object({ mode: z.string().nullable().optional() })
      .passthrough()
      .optional()
  })
  .passthrough()

const liteLLMModelInfoSchema = z.object({
  data: z.array(liteLLMModelInfoEntrySchema)
})

const UPSTREAM_ERROR_MESSAGES: Partial<Record<number, string>> = {
  400: 'Invalid request',
  401: 'Authentication failed. The LiteLLM user virtual key may be invalid.',
  403: 'Access denied. The per-user LiteLLM virtual key may lack permission for the requested model.',
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

const canonicalizeLiteLLMBaseUrl = (url: URL): string =>
  url.href.replace(/\/+$/, '')

const normalizeLiteLLMBaseUrl = (
  value: string | null | undefined
): string | undefined => {
  const result = validateLiteLLMBaseUrlPolicy(value, {
    canonicalize: canonicalizeLiteLLMBaseUrl
  })
  return result.ok ? result.canonicalUrl : undefined
}

// No code-level fallback: a deployment without LITELLM_BASE_URL is "not
// configured" (503), exactly like missing key-management configuration. A fork
// that forgets the var must not be silently pointed at someone else's LiteLLM
// and get a confusing upstream 401 — the default lives in wrangler.jsonc, not
// here (issue #179).
const configuredLiteLLMBaseUrl = (env: Bindings): string | undefined =>
  normalizeLiteLLMBaseUrl(env.LITELLM_BASE_URL)

const configuredLiteLLMAllowedBaseUrls = (env: Bindings): Set<string> => {
  const urls = new Set<string>()
  const configured = configuredLiteLLMBaseUrl(env)
  if (configured) urls.add(configured)
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
  const result = requestedBaseUrl
    ? validateLiteLLMBaseUrlPolicy(requestedBaseUrl, {
        allowedBaseUrls: configuredLiteLLMAllowedBaseUrls(env),
        canonicalize: canonicalizeLiteLLMBaseUrl
      })
    : validateLiteLLMBaseUrlPolicy(env.LITELLM_BASE_URL, {
        canonicalize: canonicalizeLiteLLMBaseUrl
      })

  if (!result.ok) {
    if (result.reason === 'not-allowed') {
      return { ok: false, error: 'LiteLLM base URL is not allowed' }
    }
    return { ok: false, error: 'Invalid LiteLLM base URL' }
  }

  return { ok: true, baseUrl: result.canonicalUrl }
}

const appendPath = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${path}`

const litellmChatUrl = (baseUrl: string): string =>
  appendPath(baseUrl, '/v1/chat/completions')

const litellmListUrl = (baseUrl: string): string =>
  appendPath(baseUrl, '/v1/models')

const litellmModelInfoUrl = (baseUrl: string): string =>
  appendPath(baseUrl, '/model/info')

const litellmHeaders = (apiKey: string): Record<string, string> => ({
  authorization: `Bearer ${apiKey}`
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

// Defense-in-depth: never let a credential survive into a client-visible error
// body. The chat route surfaces LiteLLM 400/422 messages verbatim, and some
// LiteLLM error formats echo the bearer that was presented (e.g. "Received
// Key=sk-...") — which here is the per-user virtual key the edge mints. Scrub
// `sk-` style keys and `Bearer <token>` before returning the message.
const redactSecrets = (message: string): string =>
  message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]{6,}/g, 'sk-[redacted]')

const safeUpstreamError = (rawText: string, fallback: string): string => {
  const message = redactSecrets(extractUpstreamErrorMessage(rawText) ?? fallback)
  return message.length > MAX_UPSTREAM_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_UPSTREAM_ERROR_MESSAGE_LENGTH - 3)}...`
    : message
}

const liteLLMCacheScope = (baseUrl: string): string =>
  encodeURIComponent(baseUrl)

// Exported so /health reports `degraded` under EXACTLY the rule the models
// routes 503 on — including base-URL validity (https, no credentials/query/
// fragment) and per-user key-management configuration, not just presence.
export const requireLiteLLMConfiguration = (
  env: Bindings
): string | undefined => {
  if (!configuredLiteLLMBaseUrl(env)) return 'LiteLLM is not configured.'
  return requireLiteLLMUserKeyConfiguration(env)
}

// `/v1/models` carries no `mode`, so when `/model/info` is unavailable the
// model NAME is the only embedding signal: match 'embedding' anywhere plus
// 'embed' as a standalone token (cohere/embed-english-v3.0). Models whose
// names carry no hint at all (voyage-2) are only caught by the mode lookup.
const looksLikeEmbeddingModel = (id: string): boolean => {
  const lower = id.toLowerCase()
  return lower.includes('embedding') || /(^|[^a-z])embed($|[^a-z])/.test(lower)
}

/**
 * Best-effort `id -> mode` lookup from LiteLLM's `/model/info`, which exposes
 * `mode: chat|embedding|...` that the OpenAI-compatible `/v1/models` omits.
 * Returns an empty map on any failure (older LiteLLM deployments or
 * restricted virtual keys may not serve the endpoint) — the catalogue then
 * falls back to the name heuristic. Only runs on a catalogue cache miss, so
 * the extra upstream call is rare.
 */
const fetchLiteLLMModelModes = async (
  env: Bindings,
  baseUrl: string,
  apiKey: string
): Promise<Map<string, string>> => {
  const modes = new Map<string, string>()
  const response = await fetchWithTimeout(
    {
      area: 'models.list.info',
      origin: 'litellm',
      method: 'GET',
      url: litellmModelInfoUrl(baseUrl),
      accept: {
        status: [400, 401, 403, 404, 429],
        reason:
          'mode enrichment is best-effort: older LiteLLM deployments or restricted virtual keys may not serve /model/info; the catalogue falls back to the embedding name heuristic (issue #179)'
      }
    },
    { headers: litellmHeaders(apiKey) },
    10_000
  ).catch(() => undefined)
  if (!response?.ok) return modes
  const parsed = liteLLMModelInfoSchema.safeParse(
    await response.json().catch(() => undefined)
  )
  if (!parsed.success) return modes
  for (const entry of parsed.data.data) {
    const mode = entry.model_info?.mode
    if (typeof mode === 'string' && mode.trim()) {
      modes.set(entry.model_name.trim(), mode.trim().toLowerCase())
    }
  }
  return modes
}

const toLiteLLMModels = (
  raw: unknown,
  modes: ReadonlyMap<string, string> = new Map()
): ModelEntry[] => {
  const parsed = liteLLMModelsCatalogSchema.safeParse(raw)
  const entries = parsed.success ? parsed.data.data : []
  return entries.flatMap((model) => {
    const id = model.id.trim()
    if (!id) return []
    // Drop embedding models from the chat picker: trust the /model/info mode
    // when known, fall back to the name heuristic otherwise.
    const mode = modes.get(id)
    const isEmbedding =
      mode !== undefined ? mode === 'embedding' : looksLikeEmbeddingModel(id)
    if (isEmbedding) return []
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

// The fixed set of error responses preflight itself can emit, all declared on
// both model routes. Kept as discrete per-status members so each stays
// assignable to the routes' generated typed-response unions (a single
// union-status TypedResponse would not be).
type PreflightErrorResponse =
  | TypedResponse<{ error: string }, 400, 'json'>
  | TypedResponse<{ error: string }, 401, 'json'>
  | TypedResponse<{ error: string }, 403, 'json'>
  | TypedResponse<{ error: string }, 503, 'json'>

type LiteLLMPreflightResult<S> =
  | {
      ok: true
      resolvedBaseUrl: string
      credentialKey: CredentialKey
      telemetryProvider: string
      identity: CallerIdentity
      isAnonymous: boolean
      userKey?: LiteLLMUserKey
    }
  | { ok: false; response: S | PreflightErrorResponse }

interface LiteLLMPreflightArgs<S> {
  requestedBaseUrl: string | null | undefined
  area: 'models.chat' | 'models.list'
  requestedProvider: ModelProviderId | undefined
  requireUserKey?: boolean
  /**
   * User-scoped short-circuit, evaluated AFTER GitHub caller validation and
   * per-user credential-key resolution but BEFORE provisioning the LiteLLM
   * virtual key. Return a response to answer immediately (a still-open user
   * backoff window for chat; a fresh catalogue cache hit or open window for
   * list), or `undefined` to proceed. Its
   * return type is preserved (generic `S`) so each route's typed `c.json(...)`
   * responses survive the round trip through this helper.
   */
  shortCircuit?: (ctx: {
    resolvedBaseUrl: string
    credentialKey: CredentialKey
    identity: CallerIdentity
  }) => Promise<S | undefined>
}

/**
 * Shared pre-flight for both LiteLLM-backed model routes: the auth-presence
 * check, provider telemetry, configuration guard, base-URL resolution +
 * allowlist, GitHub identity validation, and the per-user backoff key.
 *
 * Identity now runs before any model-route short-circuit because cache/backoff
 * state and LiteLLM virtual keys are user-scoped. That removes the older
 * deployment-wide "cache before GitHub" optimization, but the validation cache
 * keeps repeated ReAct calls cheap while preserving per-user access control.
 */
const preflightLiteLLM = async <S = never>(
  c: Context<{ Bindings: Bindings }>,
  {
    requestedBaseUrl,
    area,
    requestedProvider,
    requireUserKey = false,
    shortCircuit
  }: LiteLLMPreflightArgs<S>
): Promise<LiteLLMPreflightResult<S>> => {
  const authorization =
    c.req.header('authorization') ?? c.req.header('Authorization')
  const isAnonymous = !authorization

  const telemetryProvider = trackRequestedProvider(area, requestedProvider)

  // Configuration first: a deployment without a key or base URL is a 503 "not
  // configured", not a 400 about the (absent) default base URL.
  const configurationError = requireLiteLLMConfiguration(c.env)
  if (configurationError) {
    return {
      ok: false,
      response: c.json(
        edgeErrorResponseSchema.parse({ error: configurationError }),
        503
      )
    }
  }

  const litellmBaseUrl = resolveLiteLLMBaseUrl(c.env, requestedBaseUrl)
  if (!litellmBaseUrl.ok) {
    return {
      ok: false,
      response: c.json(
        edgeErrorResponseSchema.parse({ error: litellmBaseUrl.error }),
        400
      )
    }
  }
  const resolvedBaseUrl = litellmBaseUrl.baseUrl

  let identity: CallerIdentity
  let credentialKey: CredentialKey

  if (isAnonymous) {
    identity = ANONYMOUS_IDENTITY
    credentialKey = await deriveAnonymousCredentialKey(c.env, resolvedBaseUrl)
  } else {
    const callerValidation = await validateLiteLLMCaller(authorization, c.env)
    if (callerValidation.status === 'invalid') {
      return {
        ok: false,
        response: c.json(
          edgeErrorResponseSchema.parse({ error: 'Unauthorized' }),
          401
        )
      }
    }
    if (callerValidation.status === 'forbidden') {
      return {
        ok: false,
        response: c.json(
          edgeErrorResponseSchema.parse({ error: 'Forbidden' }),
          403
        )
      }
    }
    if (callerValidation.status === 'unavailable') {
      return {
        ok: false,
        response: c.json(
          edgeErrorResponseSchema.parse({
            error: 'LiteLLM caller validation is temporarily unavailable.'
          }),
          503
        )
      }
    }

    identity = callerValidation.identity
    // Scope the backoff to the authenticated user, LiteLLM deployment, AND the
    // per-deployment key namespace. One user's exhausted virtual key must not
    // short-circuit another user's quota, and two deployments sharing a backend
    // must not share each other's provisioning marker (see
    // deriveLiteLLMUserCredentialKey).
    credentialKey = await deriveLiteLLMUserCredentialKey(
      c.env,
      identity,
      resolvedBaseUrl
    )
  }

  if (shortCircuit) {
    const early = await shortCircuit({
      resolvedBaseUrl,
      credentialKey,
      identity
    })
    if (early !== undefined) return { ok: false, response: early }
  }

  const userKey = requireUserKey
    ? isAnonymous
      ? await resolveAnonymousLiteLLMKey(c.env, resolvedBaseUrl)
      : await resolveLiteLLMUserKey(c.env, resolvedBaseUrl, identity)
    : undefined
  if (requireUserKey && !userKey) {
    return {
      ok: false,
      response: c.json(
        edgeErrorResponseSchema.parse({
          error: 'LiteLLM user key provisioning is temporarily unavailable.'
        }),
        503
      )
    }
  }

  return {
    ok: true,
    resolvedBaseUrl,
    credentialKey,
    telemetryProvider,
    identity,
    isAnonymous,
    ...(userKey ? { userKey } : {})
  }
}

export const registerModelRoutes = (
  app: OpenAPIHono<{ Bindings: Bindings }>
) => {
  app.openapi(modelsChatRoute, async (c) => {
    const body = c.req.valid('json')
    const useStream = body.stream === true

    // Chat is NOT cacheable, so after identity validation resolves the user's
    // backoff key, a still-open upstream rate-limit window answers with a 429
    // (durable across isolates) instead of re-hammering the provider
    // (TINYTINKERER-EDGE-4).
    const preflight = await preflightLiteLLM(c, {
      requestedBaseUrl: body.litellmBaseUrl,
      area: 'models.chat',
      requestedProvider: body.provider,
      requireUserKey: true,
      shortCircuit: async ({ credentialKey }) => {
        const backoffMs = await getActiveBackoffMs(Date.now(), credentialKey)
        if (backoffMs > 0) {
          c.header('Retry-After', String(Math.ceil(backoffMs / 1000)))
          return c.json(rateLimitResponseFromMs(backoffMs), 429)
        }
        return undefined
      }
    })
    if (!preflight.ok) return preflight.response
    const { resolvedBaseUrl, credentialKey, telemetryProvider, isAnonymous: _isAnonymous, userKey } =
      preflight
    if (!userKey) {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'LiteLLM user key provisioning is temporarily unavailable.'
        }),
        503
      )
    }
    const model = body.model ?? DEFAULT_LITELLM_MODEL

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
          ...litellmHeaders(userKey.apiKey),
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

      if (response.status === 401 || response.status === 403) {
        await clearLiteLLMUserKeyCache(credentialKey)
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
    const query = c.req.valid('query')

    // The catalogue is cacheable, but access control and backoff are user-
    // scoped: preflight validates GitHub first, then this short-circuit can
    // serve a fresh shared catalogue or honor the user's still-open backoff
    // window before provisioning/fetching a LiteLLM virtual key. `cached` is
    // hoisted because the post-fetch 429 handler reuses it to break the
    // cascade.
    let cached: Awaited<ReturnType<typeof readCachedModels>> | undefined
    const preflight = await preflightLiteLLM(c, {
      requestedBaseUrl: query.litellmBaseUrl,
      area: 'models.list',
      requestedProvider: query.provider,
      shortCircuit: async ({ resolvedBaseUrl, credentialKey }) => {
        // The catalogue rarely changes and is identical for every caller. Serve
        // a fresh cached copy without touching upstream — this is what actually
        // stops us re-probing the upstream provider on every request and
        // tripping its rate limit (TINYTINKERER-EDGE-4 / FRONTEND-5). The
        // reactive backoff below is only a secondary guard; the per-isolate
        // version shipped in PR #100 reset on every fresh Cloudflare isolate,
        // which is why the 429s regressed.
        cached = await readCachedModels(
          Date.now(),
          liteLLMCacheScope(resolvedBaseUrl)
        )
        if (cached && isFresh(cached.ageMs)) {
          return c.json({ models: cached.models }, 200)
        }

        // Honor a still-open rate-limit window shared with the chat route for
        // this credential (durable across isolates). Prefer the last-known
        // catalogue over cascading anything.
        const backoffMs = await getActiveBackoffMs(Date.now(), credentialKey)
        if (backoffMs > 0) {
          if (cached) return c.json({ models: cached.models }, 200)
          // No cached catalogue yet but a window is open: emit the SAME single
          // cooldown signal as the cold-cache-miss path below — a graceful 503 +
          // Retry-After — instead of leaking the raw upstream 429. The browser
          // is not itself rate limited; one status keeps the frontend contract
          // for this cacheable catalogue simple: serve last-known and retry
          // later (TINYTINKERER-FRONTEND-C / FRONTEND-D).
          c.header('Retry-After', String(Math.ceil(backoffMs / 1000)))
          return c.json(
            edgeErrorResponseSchema.parse({
              error: UPSTREAM_ERROR_MESSAGES[503]
            }),
            503
          )
        }
        return undefined
      }
    })
    if (!preflight.ok) return preflight.response
    const { resolvedBaseUrl, credentialKey, telemetryProvider, identity, isAnonymous } =
      preflight
    const listUrl = litellmListUrl(resolvedBaseUrl)
    const cacheScope = liteLLMCacheScope(resolvedBaseUrl)

    const userKey = isAnonymous
      ? await resolveAnonymousLiteLLMKey(c.env, resolvedBaseUrl)
      : await resolveLiteLLMUserKey(c.env, resolvedBaseUrl, identity)
    if (!userKey) {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'LiteLLM user key provisioning is temporarily unavailable.'
        }),
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
        headers: litellmHeaders(userKey.apiKey)
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
      if (response.status === 401 || response.status === 403) {
        await clearLiteLLMUserKeyCache(credentialKey)
      }
      return c.json(
        edgeErrorResponseSchema.parse({ error: safeError }),
        statusCode
      )
    }

    // Upstream succeeded — clear any backoff window.
    await clearBackoff(credentialKey)

    // Enrich with /model/info modes (best-effort) so embedding models are
    // dropped by their declared mode, not just by name (issue #179).
    const modes = await fetchLiteLLMModelModes(
      c.env,
      resolvedBaseUrl,
      userKey.apiKey
    )
    const models = toLiteLLMModels(await response.json(), modes)

    // Populate the colo-wide cache so the next request (in any isolate) skips
    // the upstream fetch for the freshness window.
    await writeCachedModels(models, Date.now(), cacheScope)

    return c.json({ models }, 200)
  })
}
