import { zValidator } from '@hono/zod-validator'
import { modelsChatRequestSchema, modelsChatResponseSchema } from '@tinytinkerer/contracts'
import type { Hono } from 'hono'
import type { Bindings } from '../lib/bindings'
import { fetchWithTimeout } from '../lib/fetch'
import { toRateLimitResponse } from '../lib/rate-limit'

const GITHUB_MODELS_DEFAULT_URL = 'https://models.github.ai/inference'

const UPSTREAM_ERROR_MESSAGES: Partial<Record<number, string>> = {
  400: 'Invalid request',
  401: 'Authentication failed. Your GitHub token may be invalid or expired.',
  403: 'Access denied. Check your GitHub token permissions.',
  500: 'Upstream service error',
  503: 'Upstream service unavailable'
}

const UPSTREAM_ERROR_STATUSES = new Set([400, 401, 403, 500, 503])

export const registerModelRoutes = (app: Hono<{ Bindings: Bindings }>) => {
  app.post('/api/models/chat', zValidator('json', modelsChatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')

    if (!authorization) {
      return c.json({ error: 'Unauthorized' }, 401)
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
        return c.json(rateLimitBody, 429)
      }

      const safeError =
        UPSTREAM_ERROR_MESSAGES[response.status] ?? `Upstream error ${response.status}`
      const statusCode = UPSTREAM_ERROR_STATUSES.has(response.status)
        ? (response.status as 400 | 401 | 403 | 500 | 503)
        : 502
      return c.json({ error: safeError }, statusCode)
    }

    if (useStream && response.body) {
      const origin = c.env.ALLOWED_ORIGIN ?? '*'
      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': origin,
          ...(origin !== '*' ? { Vary: 'Origin' } : {})
        }
      })
    }

    const rawText = await response.text()
    return c.json(modelsChatResponseSchema.parse(JSON.parse(rawText)), 200)
  })
}
