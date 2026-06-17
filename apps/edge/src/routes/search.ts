import type { OpenAPIHono } from '@hono/zod-openapi'
import {
  edgeErrorResponseSchema,
  searchResponseSchema,
  searchResultSchema,
  type SearchResult
} from '@tinytinkerer/contracts'
import { z } from 'zod'
import type { Bindings } from '../lib/bindings'
import { fetchWithTimeout } from '../lib/fetch'
import { validateLiteLLMCaller } from '../lib/caller-validation'
import { searchRoute } from '../openapi/routes'

const tavilyResultItemSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  content: z.string().optional(),
  snippet: z.string().optional()
})

const tavilyResponseSchema = z.object({
  results: z.array(tavilyResultItemSchema).optional()
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

      return searchResultSchema.parse({ title, url, snippet })
    })
    .filter((value): value is SearchResult => Boolean(value))

export const registerSearchRoutes = (app: OpenAPIHono<{ Bindings: Bindings }>) => {
  app.openapi(searchRoute, async (c) => {
    const authorization = c.req.header('authorization') ?? c.req.header('Authorization')

    if (!authorization) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }

    const input = c.req.valid('json')

    if (!c.env.TAVILY_API_KEY) {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'Web search is currently unavailable. Configure Tavily to enable live search.'
        }),
        503
      )
    }

    // The Tavily key is a shared, server-funded credential, so validate the
    // caller's GitHub identity before spending it — a merely present
    // Authorization header is not enough (mirrors the models routes).
    const callerValidation = await validateLiteLLMCaller(authorization, c.env)
    if (callerValidation.status === 'invalid') {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }), 401)
    }
    if (callerValidation.status === 'forbidden') {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Forbidden' }), 403)
    }
    if (callerValidation.status === 'unavailable') {
      return c.json(
        edgeErrorResponseSchema.parse({
          error: 'Caller validation is temporarily unavailable.'
        }),
        503
      )
    }

    const response = await fetchWithTimeout(
      {
        area: 'search.query',
        origin: 'tavily',
        method: 'POST',
        url: 'https://api.tavily.com/search'
      },
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
      return c.json(edgeErrorResponseSchema.parse({ error: 'Web search request failed.' }), 502)
    }

    const parsed = tavilyResponseSchema.safeParse(await response.json())
    const results = parsed.success ? (parsed.data.results ?? []) : []

    return c.json(
      searchResponseSchema.parse({
        query: input.query,
        results: normalizeSearchResults(results)
      }),
      200
    )
  })
}
