import type { OpenAPIHono } from '@hono/zod-openapi'
import type { SystemStatus } from '@tinytinkerer/contracts'
import type { Bindings } from '../lib/bindings'
import { healthRoute } from '../openapi/routes'

export const registerHealthRoute = (
  app: OpenAPIHono<{ Bindings: Bindings }>
) => {
  app.openapi(healthRoute, (c) => {
    const status: SystemStatus = {
      auth: {
        state: c.env.GITHUB_CLIENT_ID ? 'ready' : 'degraded',
        detail: c.env.GITHUB_CLIENT_ID
          ? 'GitHub OAuth configured'
          : 'Missing GitHub OAuth environment variables'
      },
      models: {
        state: c.env.LITELLM_API_KEY ? 'ready' : 'degraded',
        detail: c.env.LITELLM_API_KEY
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
