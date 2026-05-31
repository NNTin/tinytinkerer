import * as Sentry from '@sentry/cloudflare'
import { scrubEvent } from '@tinytinkerer/sentry-telemetry'
import { Hono } from 'hono'
import type { Bindings } from './lib/bindings'
import { corsMiddleware } from './lib/cors'
import './lib/sentry'
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
    tracesSampleRate: 0,
    // Never collect user-typed content. Request bodies (chat messages, search
    // queries), query strings, and auth headers are stripped before any event
    // leaves the edge via the shared scrubber; see docs/PRIVACY.md.
    sendDefaultPii: false,
    beforeSend: scrubEvent
  }),
  app
)
