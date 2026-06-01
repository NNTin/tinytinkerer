import type { Hono } from 'hono'
import { EDGE_ROUTE_PATHS, type SystemStatus } from '@tinytinkerer/contracts'
import type { Bindings } from '../lib/bindings'

export const registerHealthRoute = (app: Hono<{ Bindings: Bindings }>) => {
  app.get(EDGE_ROUTE_PATHS.health, (c) => {
    const status: SystemStatus = {
      auth: {
        state: c.env.GITHUB_CLIENT_ID ? 'ready' : 'degraded',
        detail: c.env.GITHUB_CLIENT_ID
          ? 'GitHub OAuth configured'
          : 'Missing GitHub OAuth environment variables'
      },
      models: {
        state: 'ready',
        detail: 'GitHub Models proxy ready (sign in with GitHub to enable)'
      },
      search: {
        state: c.env.TAVILY_API_KEY ? 'ready' : 'degraded',
        detail: c.env.TAVILY_API_KEY
          ? 'Tavily proxy ready'
          : 'Web search unavailable until Tavily is configured'
      }
    }

    return c.json(status)
  })
}
