import type { OpenAPIHono } from '@hono/zod-openapi'
import {
  EDGE_RATE_LIMIT_HEADERS,
  edgeErrorResponseSchema,
  githubModelEntrySchema,
  modelsChatResponseSchema,
  type GitHubModelEntry,
  type ModelProviderId
} from '@tinytinkerer/contracts'
import { z } from 'zod'
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

const githubModelsCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  publisher: z.string().optional(),
  registry: z.string().optional(),
  summary: z.string().optional(),
  html_url: z.string().url().optional(),
  version: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  limits: z
    .object({
      max_input_tokens: z.number().nullable().optional(),
      max_output_tokens: z.number().nullable().optional()
    })
    .optional(),
  rate_limit_tier: z.string().optional(),
  supported_input_modalities: z.array(z.string()).optional(),
  supported_output_modalities: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
})

const githubModelsCatalogSchema = z.array(githubModelsCatalogEntrySchema)

const openRouterModelsCatalogEntrySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    context_length: z.number().nullable().optional(),
    pricing: z.record(z.string(), z.unknown()).optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional(),
        output_modalities: z.array(z.string()).optional()
      })
      .passthrough()
      .optional(),
    supported_parameters: z.array(z.string()).optional()
  })
  .passthrough()

const openRouterModelsCatalogSchema = z.object({
  data: z.array(openRouterModelsCatalogEntrySchema)
})

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

const GITHUB_MODELS_DEFAULT_URL = 'https://models.github.ai/inference'
const GITHUB_MODELS_CATALOG_URL = 'https://models.github.ai/catalog/models'
const GITHUB_MODELS_REFERENCE_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2026-03-10'
} as const
// api.github.com (the core REST API) rejects requests without a User-Agent with
// a 403 ("Request forbidden by administrative rules ... User-Agent header
// required"). Cloudflare Workers' `fetch` does not set one, so the LiteLLM
// caller-validation probe below must send it explicitly or EVERY call 403s and
// is mis-read as an invalid caller -> a spurious 401 (TINYTINKERER-FRONTEND-N/P/Q/R).
const GITHUB_API_USER_AGENT = 'tinytinkerer-edge'
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_DEFAULT_MODELS_URL = `${OPENROUTER_DEFAULT_BASE_URL}/models`
const DEFAULT_OPENROUTER_REFERER = 'https://tiny.nntin.xyz'
const DEFAULT_OPENROUTER_TITLE = 'TinyTinkerer'
const LITELLM_DEFAULT_BASE_URL = 'https://litellm.labs.lair.nntin.xyz/'

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

type ModelProviderAdapter = {
  id: ModelProviderId
  origin: 'github' | 'openrouter' | 'litellm'
  displayName: string
  defaultModel: string
  chatUrl: (env: Bindings, baseUrl?: string) => string
  listUrl: (env: Bindings, baseUrl?: string) => string
  headers: (
    env: Bindings,
    authorization: string,
    baseUrl?: string
  ) => Record<string, string>
  parseCatalog: (raw: unknown) => GitHubModelEntry[]
  errorMessages: Partial<Record<number, string>>
}

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

const liteLLMCacheScope = (baseUrl: string): string =>
  encodeURIComponent(baseUrl)

const liteLLMSharedCredentialKeyInput = (
  env: Bindings,
  baseUrl: string
): string => `litellm:${env.LITELLM_API_KEY ?? ''}:${baseUrl}`

const requireLiteLLMConfiguration = (
  env: Bindings
): string | undefined => {
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

const toGitHubModels = (raw: unknown): GitHubModelEntry[] => {
  const parsed = githubModelsCatalogSchema.safeParse(raw)
  return (parsed.success ? parsed.data : []).map((model) =>
    githubModelEntrySchema.parse({
      provider: 'github',
      ...model,
      label: model.name ?? model.id,
      kind:
        model.id.includes('/text-embedding') ||
        model.tags?.includes('embedding')
          ? 'embedding'
          : 'chat'
    })
  )
}

const toOpenRouterModels = (raw: unknown): GitHubModelEntry[] => {
  const parsed = openRouterModelsCatalogSchema.safeParse(raw)
  const entries = parsed.success ? parsed.data.data : []
  return entries.flatMap((model) => {
    const inputModalities = model.architecture?.input_modalities ?? []
    const outputModalities = model.architecture?.output_modalities ?? []
    if (!outputModalities.includes('text')) return []

    const publisher = model.id.includes('/')
      ? model.id.split('/')[0]
      : undefined
    const limits = model.context_length
      ? { max_input_tokens: model.context_length }
      : undefined
    return [
      githubModelEntrySchema.parse({
        provider: 'openrouter',
        id: model.id,
        label: model.name ?? model.id,
        kind: 'chat',
        ...(model.name ? { name: model.name } : {}),
        ...(publisher ? { publisher } : {}),
        ...(model.description ? { summary: model.description } : {}),
        ...(model.context_length !== undefined
          ? { context_length: model.context_length }
          : {}),
        ...(model.pricing ? { pricing: model.pricing } : {}),
        ...(model.architecture ? { architecture: model.architecture } : {}),
        ...(model.supported_parameters
          ? { capabilities: model.supported_parameters }
          : {}),
        ...(limits ? { limits } : {}),
        supported_input_modalities: inputModalities,
        supported_output_modalities: outputModalities
      })
    ]
  })
}

const toLiteLLMModels = (raw: unknown): GitHubModelEntry[] => {
  const parsed = liteLLMModelsCatalogSchema.safeParse(raw)
  const entries = parsed.success ? parsed.data.data : []
  return entries.flatMap((model) => {
    const id = model.id.trim()
    if (!id || id.toLowerCase().includes('embedding')) return []
    const publisher = id.includes('/') ? id.split('/')[0] : model.owned_by
    return [
      githubModelEntrySchema.parse({
        provider: 'litellm',
        id,
        label: id,
        kind: 'chat',
        ...(publisher ? { publisher } : {})
      })
    ]
  })
}

const providerAdapters: Record<ModelProviderId, ModelProviderAdapter> = {
  github: {
    id: 'github',
    origin: 'github',
    displayName: 'GitHub Models',
    defaultModel: 'openai/gpt-4.1-mini',
    chatUrl: (env) =>
      `${env.GITHUB_MODELS_URL ?? GITHUB_MODELS_DEFAULT_URL}/chat/completions`,
    listUrl: (env) =>
      env.GITHUB_MODELS_CATALOG_URL ?? GITHUB_MODELS_CATALOG_URL,
    headers: (_env, authorization) => ({
      ...GITHUB_MODELS_REFERENCE_HEADERS,
      authorization
    }),
    parseCatalog: toGitHubModels,
    errorMessages: UPSTREAM_ERROR_MESSAGES
  },
  openrouter: {
    id: 'openrouter',
    origin: 'openrouter',
    displayName: 'OpenRouter',
    defaultModel: 'openai/gpt-4.1-mini',
    chatUrl: (env) =>
      `${env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL}/chat/completions`,
    listUrl: (env) =>
      env.OPENROUTER_MODELS_URL ?? OPENROUTER_DEFAULT_MODELS_URL,
    headers: (env, authorization) => ({
      authorization,
      'HTTP-Referer':
        env.OPENROUTER_HTTP_REFERER ?? DEFAULT_OPENROUTER_REFERER,
      'X-OpenRouter-Title':
        env.OPENROUTER_APP_TITLE ?? DEFAULT_OPENROUTER_TITLE,
      ...(env.OPENROUTER_CATEGORIES
        ? { 'X-OpenRouter-Categories': env.OPENROUTER_CATEGORIES }
        : {})
    }),
    parseCatalog: toOpenRouterModels,
    errorMessages: {
      ...UPSTREAM_ERROR_MESSAGES,
      401: 'Authentication failed. Your OpenRouter API key may be invalid.',
      403: 'Access denied. Check your OpenRouter API key permissions.'
    }
  },
  litellm: {
    id: 'litellm',
    origin: 'litellm',
    displayName: 'LiteLLM',
    defaultModel: 'openai/gpt-5',
    chatUrl: (env, baseUrl) =>
      appendPath(
        baseUrl ?? configuredLiteLLMBaseUrl(env),
        '/v1/chat/completions'
      ),
    listUrl: (env, baseUrl) =>
      appendPath(baseUrl ?? configuredLiteLLMBaseUrl(env), '/v1/models'),
    headers: (env) => ({
      authorization: `Bearer ${env.LITELLM_API_KEY?.trim() ?? ''}`
    }),
    parseCatalog: toLiteLLMModels,
    errorMessages: {
      ...UPSTREAM_ERROR_MESSAGES,
      401: 'Authentication failed. The configured LiteLLM virtual key may be invalid.',
      403: 'Access denied. Check the configured LiteLLM virtual key permissions.'
    }
  }
}

const getAdapter = (provider: ModelProviderId | undefined): ModelProviderAdapter =>
  providerAdapters[provider ?? 'github']

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
    const adapter = getAdapter(body.provider)
    const litellmBaseUrl =
      adapter.id === 'litellm'
        ? resolveLiteLLMBaseUrl(c.env, body.litellmBaseUrl)
        : undefined
    if (litellmBaseUrl && !litellmBaseUrl.ok) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: litellmBaseUrl.error }),
        400
      )
    }
    if (adapter.id === 'litellm') {
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
    }
    const resolvedLiteLLMBaseUrl =
      litellmBaseUrl && litellmBaseUrl.ok ? litellmBaseUrl.baseUrl : undefined
    const model = body.model ?? adapter.defaultModel

    // Scope the backoff to the upstream credential/quota bucket. For GitHub/OpenRouter
    // this is the caller's token/key; for LiteLLM it's the shared edge-managed key
    // (plus base URL) so one caller's 429 correctly backs off all callers.
    const credentialKey = await deriveCredentialKey(
      adapter.id === 'litellm' && resolvedLiteLLMBaseUrl
        ? liteLLMSharedCredentialKeyInput(c.env, resolvedLiteLLMBaseUrl)
        : authorization
    )

    // Respect a still-open upstream rate-limit window (durable across isolates):
    // short-circuit with a 429 instead of re-hammering the upstream provider
    // (TINYTINKERER-EDGE-4).
    const backoffMs = await getActiveBackoffMs(Date.now(), adapter.id, credentialKey)
    if (backoffMs > 0) {
      c.header('Retry-After', String(Math.ceil(backoffMs / 1000)))
      return c.json(rateLimitResponseFromMs(backoffMs, adapter.id), 429)
    }

    const response = await fetchWithTimeout(
      {
        area: 'models.chat',
        origin: adapter.origin,
        method: 'POST',
        url: adapter.chatUrl(c.env, resolvedLiteLLMBaseUrl),
        model,
        stream: useStream,
        // Chat completions are NOT cacheable, so after we durably honour the
        // upstream rate-limit window (above) the residual 429 — the first call
        // that opens a new window — is a user-triggered, unavoidable provider
        // rate limit. The frontend surfaces it as a cooldown; capturing
        // it adds no signal (TINYTINKERER-EDGE-4 / FRONTEND-9).
        accept: {
          status: [429],
          reason:
            `${adapter.displayName} chat rate limit; honoured via durable backoff + clean 429/Retry-After, surfaced to the user as a cooldown (TINYTINKERER-EDGE-4).`
        }
      },
      {
        method: 'POST',
        headers: {
          ...adapter.headers(c.env, authorization, resolvedLiteLLMBaseUrl),
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
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
        const rateLimitBody = toRateLimitResponse(
          rawText,
          retryAfter,
          adapter.id
        )
        // Remember the window (durably, colo-wide) so the next call backs off
        // instead of re-probing.
        await recordBackoff(
          rateLimitBody.retryAfterMs,
          Date.now(),
          adapter.id,
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

      const safeError =
        adapter.errorMessages[response.status] ??
        `Upstream error ${response.status}`
      const statusCode = UPSTREAM_ERROR_STATUSES.has(response.status)
        ? (response.status as 400 | 401 | 403 | 422 | 500 | 503 | 504)
        : 502
      return c.json(
        edgeErrorResponseSchema.parse({ error: safeError }),
        statusCode
      )
    }

    // Upstream accepted the request — clear any backoff window.
    await clearBackoff(adapter.id, credentialKey)

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
    const adapter = getAdapter(query.provider)
    const litellmBaseUrl =
      adapter.id === 'litellm'
        ? resolveLiteLLMBaseUrl(c.env, query.litellmBaseUrl)
        : undefined
    if (litellmBaseUrl && !litellmBaseUrl.ok) {
      return c.json(
        edgeErrorResponseSchema.parse({ error: litellmBaseUrl.error }),
        400
      )
    }
    if (adapter.id === 'litellm') {
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
    }
    const resolvedLiteLLMBaseUrl =
      litellmBaseUrl && litellmBaseUrl.ok ? litellmBaseUrl.baseUrl : undefined
    const listUrl = adapter.listUrl(c.env, resolvedLiteLLMBaseUrl)
    const cacheScope =
      adapter.id === 'litellm' && resolvedLiteLLMBaseUrl
        ? liteLLMCacheScope(resolvedLiteLLMBaseUrl)
        : ''

    // Scope the backoff to the upstream credential/quota bucket (issue #146). For
    // GitHub/OpenRouter this is the caller token/key; for LiteLLM it is the shared
    // edge-managed key (plus base URL), so one caller's 429 backs off all callers.
    const credentialKey = await deriveCredentialKey(
      adapter.id === 'litellm' && resolvedLiteLLMBaseUrl
        ? liteLLMSharedCredentialKeyInput(c.env, resolvedLiteLLMBaseUrl)
        : authorization
    )

    // The catalogue rarely changes and is identical for every caller. Serve a
    // fresh cached copy without touching upstream — this is what actually stops
    // us re-probing the upstream provider on every request and tripping its rate limit
    // (TINYTINKERER-EDGE-4 / FRONTEND-5). The reactive backoff below is only a
    // secondary guard; the per-isolate version shipped in PR #100 reset on every
    // fresh Cloudflare isolate, which is why the 429s regressed.
    const cached = await readCachedModels(adapter.id, Date.now(), cacheScope)
    if (cached && isFresh(cached.ageMs)) {
      return c.json({ models: cached.models }, 200)
    }

    // Honor a still-open rate-limit window shared with the chat route for this
    // credential (durable across isolates). Prefer the last-known catalogue over
    // cascading anything.
    const backoffMs = await getActiveBackoffMs(Date.now(), adapter.id, credentialKey)
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
        origin: adapter.origin,
        method: 'GET',
        url: listUrl,
        // models.list IS cacheable, so the catalogue cache + durable backoff above
        // are the real fix — we only reach this upstream fetch on a cache miss with
        // no active backoff window for this provider. A 429 here is therefore the cold-cache-miss
        // window-opener: the one unavoidable probe on a fresh isolate / empty Cache
        // API right after a deploy, the cacheable analogue of the non-cacheable
        // window-opener. We record the backoff below and serve last-known / a 503
        // instead of re-probing, so capturing this first probe adds no signal. This
        // is NOT a blanket accept of the cacheable 429 — the caching machinery does
        // the work; only the cold-start opener is accepted (TINYTINKERER-EDGE-5).
        accept: {
          status: [429],
          reason:
            `Cold-cache-miss window-opener: the one unavoidable probe of the ${adapter.displayName} catalogue on a fresh isolate; cache + durable backoff handle the rest and we serve last-known / 503 instead of re-probing (TINYTINKERER-EDGE-5).`
        }
      },
      { headers: adapter.headers(c.env, authorization, resolvedLiteLLMBaseUrl) },
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
          retryAfter,
          adapter.id
        )
        // Remember the window durably (colo-wide) so the next request — in any
        // isolate — backs off instead of re-probing.
        await recordBackoff(
          rateLimitBody.retryAfterMs,
          Date.now(),
          adapter.id,
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
        adapter.errorMessages[response.status] ??
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
    await clearBackoff(adapter.id, credentialKey)

    const models = adapter.parseCatalog(await response.json())

    // Populate the colo-wide cache so the next request (in any isolate) skips
    // the upstream fetch for the freshness window.
    await writeCachedModels(models, adapter.id, Date.now(), cacheScope)

    return c.json({ models }, 200)
  })
}
