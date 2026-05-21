import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { SearchResult, SystemStatus } from '@tinytinkerer/types'
import { z } from 'zod'

type Bindings = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GITHUB_MODELS_TOKEN?: string
  TAVILY_API_KEY?: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

const searchSchema = z.object({
  query: z.string().min(2),
  maxResults: z.number().int().positive().max(10).optional()
})

const normalizeSearchResults = (results: unknown[]): SearchResult[] =>
  results
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return undefined
      }

      const record = item as Record<string, unknown>
      const title = typeof record.title === 'string' ? record.title : 'Untitled'
      const url = typeof record.url === 'string' ? record.url : ''
      const snippet =
        typeof record.content === 'string'
          ? record.content
          : typeof record.snippet === 'string'
            ? record.snippet
            : ''

      if (!url) {
        return undefined
      }

      return { title, url, snippet }
    })
    .filter((value): value is SearchResult => Boolean(value))

app.get('/health', (c) => {
  const status: SystemStatus = {
    auth: {
      state: c.env.GITHUB_CLIENT_ID ? 'ready' : 'degraded',
      detail: c.env.GITHUB_CLIENT_ID
        ? 'GitHub OAuth configured'
        : 'Missing GitHub OAuth environment variables'
    },
    models: {
      state: c.env.GITHUB_MODELS_TOKEN ? 'ready' : 'degraded',
      detail: c.env.GITHUB_MODELS_TOKEN
        ? 'GitHub Models proxy ready'
        : 'Using local fallback planner/synthesizer'
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
  zValidator(
    'json',
    z.object({
      code: z.string().min(1),
      redirectUri: z.string().url().optional()
    })
  ),
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

    const response = await fetch('https://github.com/login/oauth/access_token', {
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
    })

    const payload = (await response.json()) as { access_token?: string; error?: string }

    if (!payload.access_token) {
      return c.json({ error: payload.error ?? 'OAuth exchange failed' }, 400)
    }

    return c.json({ accessToken: payload.access_token })
  }
)

app.post(
  '/api/models/plan',
  zValidator('json', z.object({ prompt: z.string().min(1) })),
  (c) => {
    const { prompt } = c.req.valid('json')
    const needsSearch = /latest|news|search|web|compare|today/i.test(prompt)
    return c.json({
      complexity: needsSearch ? 'medium' : 'low',
      steps: [
        { id: 'understand', summary: 'Understand request constraints' },
        ...(needsSearch
          ? [
              {
                id: 'search',
                summary: 'Gather external context',
                toolCall: { toolId: 'web-search', input: { query: prompt, maxResults: 5 } }
              }
            ]
          : []),
        { id: 'compose', summary: 'Compose final answer' }
      ]
    })
  }
)

app.post(
  '/api/search',
  zValidator('json', searchSchema),
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

    const response = await fetch('https://api.tavily.com/search', {
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
    })

    if (!response.ok) {
      return c.json({ error: 'Tavily request failed' }, 502)
    }

    const payload = (await response.json()) as { results?: unknown[] }

    return c.json({
      query: input.query,
      results: normalizeSearchResults(payload.results ?? [])
    })
  }
)

app.post(
  '/api/models/chat',
  zValidator(
    'json',
    z.object({
      model: z.string().optional(),
      messages: z.array(
        z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string()
        })
      )
    })
  ),
  async (c) => {
    const body = c.req.valid('json')

    if (!c.env.GITHUB_MODELS_TOKEN) {
      const content =
        body.messages.at(-1)?.content ?? 'No prompt supplied. Configure GITHUB_MODELS_TOKEN for live model proxy.'
      return c.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: `Local fallback response: ${content}`
            }
          }
        ]
      })
    }

    const response = await fetch('https://models.github.ai/inference/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${c.env.GITHUB_MODELS_TOKEN}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: body.model ?? 'openai/gpt-4.1-mini',
        messages: body.messages,
        stream: false
      })
    })

    const payload: unknown = await response.json()
    return c.json(payload, response.status as 200 | 400 | 401 | 403 | 429 | 500)
  }
)

export default app
