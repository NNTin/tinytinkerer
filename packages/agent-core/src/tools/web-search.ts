import type { SearchResult } from '@tinytinkerer/types'
import { z } from 'zod'
import type { Tool } from './registry'

export const webSearchInputSchema = z.object({
  query: z.string().min(2),
  maxResults: z.number().int().positive().max(10).optional()
})

export type WebSearchInput = z.infer<typeof webSearchInputSchema>

export type WebSearchOutput = {
  query: string
  results: SearchResult[]
}

export const createWebSearchTool = (baseUrl: string): Tool<WebSearchInput, WebSearchOutput> => ({
  id: 'web-search',
  description: 'Search the web for fresh context using Tavily.',
  schema: webSearchInputSchema,
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

    const payload = (await response.json()) as { query: string; results: SearchResult[] }
    return {
      query: payload.query,
      results: payload.results
    }
  }
})
