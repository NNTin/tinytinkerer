import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { DEFAULT_RATE_LIMIT_RETRY_AFTER_MS, parseRetryAfterMs } from '@tinytinkerer/shared'
import {
  chatRequestSchema,
  githubExchangeRequestSchema,
  searchRequestSchema,
} from '@tinytinkerer/contracts'
import type { SearchResult, SystemStatus } from '@tinytinkerer/contracts'
import { z } from 'zod'

const githubOAuthResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional()
})

const tavilyResultItemSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  content: z.string().optional(),
  snippet: z.string().optional()
})

const tavilyResponseSchema = z.object({
  results: z.array(tavilyResultItemSchema).optional()
})

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            role: z.string().optional(),
            content: z.string().nullable().optional()
          })
          .optional(),
        finish_reason: z.string().optional()
      })
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional()
    })
    .optional()
})

type Bindings = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  TAVILY_API_KEY?: string
  ALLOWED_ORIGIN?: string
  GITHUB_MODELS_URL?: string
}

const GITHUB_MODELS_DEFAULT_URL = 'https://models.github.ai/inference'

const fetchWithTimeout = (url: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId))
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN ?? '*'

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
      }
    })
  }

  await next()
  c.res.headers.set('Access-Control-Allow-Origin', origin)
  if (origin !== '*') {
    c.res.headers.append('Vary', 'Origin')
  }
})

type TavilyResultItem = z.infer<typeof tavilyResultItemSchema>

const normalizeSearchResults = (results: TavilyResultItem[]): SearchResult[] =>
  results
    .map((item) => {
      const title = item.title ?? 'Untitled'
      const url = item.url ?? ''
      const snippet = item.content ?? item.snippet ?? ''

      if (!url) {
        return undefined
      }

      return { title, url, snippet }
    })
    .filter((value): value is SearchResult => Boolean(value))

const toRateLimitResponse = (rawText: string, retryAfter: string | null) => {
  const retryAfterMs = parseRetryAfterMs(retryAfter) ?? DEFAULT_RATE_LIMIT_RETRY_AFTER_MS
  const retryAt = new Date(Date.now() + retryAfterMs).toISOString()

  return {
    code: 'rate_limited',
    error: rawText || 'GitHub Models is rate limited',
    retryAfterMs,
    retryAt
  }
}

app.get('/health', (c) => {
  const status: SystemStatus = {
    auth: {
      state: c.env.GITHUB_CLIENT_ID ? 'ready' : 'degraded',
      detail: c.env.GITHUB_CLIENT_ID
        ? 'GitHub OAuth configured'
        : 'Missing GitHub OAuth environment variables'
    },
    models: {
      state: 'ready',
      detail: 'GitHub Models proxy ready (sign in with GitHub to enable)'
    },
    search: {
      state: c.env.TAVILY_API_KEY ? 'ready' : 'degraded',
      detail: c.env.TAVILY_API_KEY ? 'Tavily proxy ready' : 'Using mock search results'
    }
  }

  return c.json(status)
})

app.post(
  '/auth/github/exchange',
  zValidator('json', githubExchangeRequestSchema),
  async (c) => {
    const { code, redirectUri } = c.req.valid('json')
    if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
      return c.json(
        {
          error: 'OAuth is not configured'
        },
        501
      )
    }

    const response = await fetchWithTimeout(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          client_id: c.env.GITHUB_CLIENT_ID,
          client_secret: c.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri
        })
      },
      10_000
    )

    const parsed = githubOAuthResponseSchema.safeParse(await response.json())
    const payload = parsed.success ? parsed.data : {}

    if (!payload.access_token) {
      return c.json({ error: payload.error ?? 'OAuth exchange failed' }, 400)
    }

    return c.json({ accessToken: payload.access_token })
  }
)

app.post(
  '/api/search',
  zValidator('json', searchRequestSchema),
  async (c) => {
    const input = c.req.valid('json')

    if (!c.env.TAVILY_API_KEY) {
      return c.json({
        query: input.query,
        results: [
          {
            title: 'Search unavailable',
            url: 'https://tavily.com/',
            snippet: 'Set TAVILY_API_KEY in edge environment to enable live web search.'
          }
        ]
      })
    }

    const response = await fetchWithTimeout(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          api_key: c.env.TAVILY_API_KEY,
          query: input.query,
          max_results: input.maxResults ?? 5,
          include_answer: false,
          include_raw_content: false
        })
      },
      10_000
    )

    if (!response.ok) {
      return c.json({ error: 'Tavily request failed' }, 502)
    }

    const parsed = tavilyResponseSchema.safeParse(await response.json())
    const results = parsed.success ? (parsed.data.results ?? []) : []

    return c.json({
      query: input.query,
      results: normalizeSearchResults(results)
    })
  }
)

const UPSTREAM_ERROR_MESSAGES: Partial<Record<number, string>> = {
  400: 'Invalid request',
  401: 'Authentication failed. Your GitHub token may be invalid or expired.',
  403: 'Access denied. Check your GitHub token permissions.',
  500: 'Upstream service error',
  503: 'Upstream service unavailable'
}

const UPSTREAM_ERROR_STATUSES = new Set([400, 401, 403, 500, 503])

app.post(
  '/api/models/chat',
  zValidator('json', chatRequestSchema),
  async (c) => {
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
    const parsed = chatCompletionSchema.safeParse(JSON.parse(rawText))
    if (!parsed.success) {
      return c.json({ error: 'Unexpected response from upstream model' }, 502)
    }
    return c.json(parsed.data, 200)
  }
)

export default app
