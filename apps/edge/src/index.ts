import * as Sentry from '@sentry/cloudflare'
import { Hono } from 'hono'
import type { Bindings } from './lib/bindings'
import { corsMiddleware } from './lib/cors'
import { telemetryMiddleware } from './lib/telemetry'
import { registerAuthRoutes } from './routes/auth'
import { registerHealthRoute } from './routes/health'
import { registerMcpRoutes } from './routes/mcp'
import { registerModelRoutes } from './routes/models'
import { registerSearchRoutes } from './routes/search'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', corsMiddleware)
app.use('*', telemetryMiddleware)

registerHealthRoute(app)
registerAuthRoutes(app)
registerSearchRoutes(app)
registerModelRoutes(app)
registerMcpRoutes(app)

export default Sentry.withSentry(
  (env: Bindings) => ({
    ...(env.SENTRY_DSN ? { dsn: env.SENTRY_DSN } : {}),
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    // Errors only — no performance tracing.
    tracesSampleRate: 0
  }),
  app
)
