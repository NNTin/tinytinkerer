import type { OpenAPIHono } from '@hono/zod-openapi'
import type { SystemStatus } from '@tinytinkerer/contracts'
import type { Bindings } from '../lib/bindings'
import { healthRoute } from '../openapi/routes'
import { requireLiteLLMConfiguration } from './models'

export const registerHealthRoute = (
  app: OpenAPIHono<{ Bindings: Bindings }>
) => {
  app.openapi(healthRoute, (c) => {
    // The same check the models routes 503 on: key present AND base URL
    // present and valid (there is no code-level base-URL fallback). Sharing
    // the helper keeps /health from reporting `ready` for an env value the
    // models routes would reject.
    const litellmConfigured = !requireLiteLLMConfiguration(c.env)
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
