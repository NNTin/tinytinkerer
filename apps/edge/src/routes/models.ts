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
import { toRateLimitResponse } from '../lib/rate-limit'

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

    const response = await fetchWithTimeout(
      `${modelsBaseUrl}/chat/completions`,
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

    const response = await fetchWithTimeout(
      listUrl,
      { headers: { authorization, accept: 'application/json' } },
      10_000
    )

    if (!response.ok) {
      console.error('[models/list] upstream error', { status: response.status, url: listUrl })
      const safeError =
        UPSTREAM_ERROR_MESSAGES[response.status] ?? `Upstream error ${response.status}`
      const statusCode = UPSTREAM_ERROR_STATUSES.has(response.status)
        ? (response.status as 400 | 401 | 403 | 422 | 500 | 503 | 504)
        : 502
      return c.json(edgeErrorResponseSchema.parse({ error: safeError }), statusCode)
    }

    const parsed = githubModelsListSchema.safeParse(await response.json())
    const models = (parsed.success ? (parsed.data.data ?? []) : []).map((m) => ({
      id: m.id,
      label: m.name ?? m.id
    }))

    return c.json({ models })
  })
}
