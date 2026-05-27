import type { Tool } from '@tinytinkerer/app-core'
import {
  edgeErrorResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
  type SearchRequest,
  type SearchResponse
} from '@tinytinkerer/contracts'
import type { EdgeFetch } from './edge-fetch'

export const createWebSearchTool = (edgeFetch: EdgeFetch): Tool<SearchRequest, SearchResponse> => ({
  id: 'web-search',
  description: 'Search the web for fresh context using Tavily.',
  schema: searchRequestSchema,
  async execute(input) {
    const response = await edgeFetch('/api/search', input)

    if (!response.ok) {
      const payload = await response
        .clone()
        .json()
        .then((value) => edgeErrorResponseSchema.safeParse(value))
        .catch(() => undefined)

      throw new Error(payload?.success ? payload.data.error : `Search failed (${response.status})`)
    }

    return searchResponseSchema.parse(await response.json())
  }
})
