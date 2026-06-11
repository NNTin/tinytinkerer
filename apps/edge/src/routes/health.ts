import type { OpenAPIHono } from '@hono/zod-openapi'
import type { SystemStatus } from '@tinytinkerer/contracts'
import type { Bindings } from '../lib/bindings'
import { healthRoute } from '../openapi/routes'

export const registerHealthRoute = (
  app: OpenAPIHono<{ Bindings: Bindings }>
) => {
  app.openapi(healthRoute, (c) => {
    // Mirrors requireLiteLLMConfiguration in ./models: both the key and the
    // base URL must be set (there is no code-level base-URL fallback).
    const litellmConfigured = Boolean(
      c.env.LITELLM_API_KEY?.trim() && c.env.LITELLM_BASE_URL?.trim()
    )
    const status: SystemStatus = {
      auth: {
        state: c.env.GITHUB_CLIENT_ID ? 'ready' : 'degraded',
        detail: c.env.GITHUB_CLIENT_ID
          ? 'GitHub OAuth configured'
          : 'Missing GitHub OAuth environment variables'
      },
      models: {
        state: litellmConfigured ? 'ready' : 'degraded',
        detail: litellmConfigured
          ? 'Model proxy ready'
          : 'LiteLLM is not configured'
      },
      search: {
        state: c.env.TAVILY_API_KEY ? 'ready' : 'degraded',
        detail: c.env.TAVILY_API_KEY
          ? 'Tavily proxy ready'
          : 'Web search unavailable until Tavily is configured'
      }
    }

    return c.json(status, 200)
  })
}
