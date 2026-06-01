import type { Tool } from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  searchRequestSchema,
  searchResponseSchema,
  type SearchRequest,
  type SearchResponse
} from '@tinytinkerer/contracts'
import type { EdgeFetch } from './edge-fetch'
import { parseJsonWithTelemetry, parseWithTelemetry } from '../telemetry/request-telemetry'

export const createWebSearchTool = (edgeFetch: EdgeFetch): Tool<SearchRequest, SearchResponse> => ({
  id: 'web-search',
  description: 'Search the web for fresh context using Tavily.',
  schema: searchRequestSchema,
  async execute(input) {
    const response = await edgeFetch(EDGE_ROUTE_PATHS.search, input, { area: 'search' })
    const metadata = {
      area: 'search' as const,
      origin: 'edge' as const,
      method: 'POST',
      url: response.url
    }

    if (!response.ok) {
      const payload = await parseJsonWithTelemetry<unknown>(metadata, response.clone())
        .then((value) => edgeErrorResponseSchema.safeParse(value))
        .catch(() => undefined)

      throw new Error(payload?.success ? payload.data.error : `Search failed (${response.status})`)
    }

    const payload = await parseJsonWithTelemetry<unknown>(metadata, response)
    return parseWithTelemetry(
      metadata,
      'schema_error',
      'Search response did not match schema',
      () => searchResponseSchema.parse(payload),
      response
    )
  }
})
