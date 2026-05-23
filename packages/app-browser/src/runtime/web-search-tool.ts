import type { Tool } from '@tinytinkerer/agent-core'
import {
  searchRequestSchema,
  searchResponseSchema,
  type SearchRequest,
  type SearchResponse
} from '@tinytinkerer/contracts'

export const createWebSearchTool = (baseUrl: string): Tool<SearchRequest, SearchResponse> => ({
  id: 'web-search',
  description: 'Search the web for fresh context using Tavily.',
  schema: searchRequestSchema,
  async execute(input) {
    const response = await fetch(`${baseUrl}/api/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(input)
    })

    if (!response.ok) {
      throw new Error(`Search failed (${response.status})`)
    }

    return searchResponseSchema.parse(await response.json())
  }
})
