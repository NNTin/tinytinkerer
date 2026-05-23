import type { SearchResult } from '@tinytinkerer/contracts'
import { z } from 'zod'
import type { Tool } from '@tinytinkerer/agent-core'

export const webSearchInputSchema = z.object({
  query: z.string().min(2).max(500),
  maxResults: z.number().int().positive().max(10).optional()
})

const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string()
})

const webSearchResponseSchema = z.object({
  query: z.string(),
  results: z.array(searchResultSchema)
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

    return webSearchResponseSchema.parse(await response.json())
  }
})
