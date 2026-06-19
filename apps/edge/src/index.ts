import { OpenAPIHono } from '@hono/zod-openapi'
import * as Sentry from '@sentry/cloudflare'
import { EDGE_ROUTE_PATHS, edgeErrorResponseSchema } from '@tinytinkerer/contracts'
import { scrubEvent } from '@tinytinkerer/sentry-telemetry'
import type { Bindings } from './lib/bindings'
import { corsMiddleware } from './lib/cors'
import { inboundRateLimit } from './lib/inbound-rate-limit'
import './lib/sentry'
import { telemetryMiddleware } from './lib/telemetry'
import { registerAuthRoutes } from './routes/auth'
import { registerHealthRoute } from './routes/health'
import { registerMcpRoutes } from './routes/mcp'
import { registerModelRoutes } from './routes/models'
import { registerSearchRoutes } from './routes/search'

// The bare Hono app, exported so it can be exercised in-process (e.g. the e2e
// suite drives the real edge worker via `app.fetch`, mocking only the LiteLLM
// upstream). The deployed entry is the Sentry-wrapped `default` export below.
export const app = new OpenAPIHono<{ Bindings: Bindings }>({
  // Failed request validation returns the same { error } shape every other edge
  // error uses (and that the OpenAPI 4xx responses document), instead of the
  // library's default validation-error payload.
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(edgeErrorResponseSchema.parse({ error: 'Invalid request' }), 400)
    }
  }
})

app.use('*', corsMiddleware)
app.use('*', telemetryMiddleware)

// Inbound per-caller throttling, ahead of the route handlers (and their request
// validation) so even malformed floods are rejected cheaply. The auth exchange
// is unauthenticated and the search/MCP proxies spend shared server-side
// resources per request; the models routes are covered by the upstream backoff
// window in lib/rate-limit.ts instead.
app.use(EDGE_ROUTE_PATHS.authGithubExchange, inboundRateLimit('auth'))
app.use(EDGE_ROUTE_PATHS.search, inboundRateLimit('search'))
app.use(EDGE_ROUTE_PATHS.mcpDiscover, inboundRateLimit('mcp'))
app.use(EDGE_ROUTE_PATHS.mcpCall, inboundRateLimit('mcp'))

registerHealthRoute(app)
registerAuthRoutes(app)
registerSearchRoutes(app)
registerModelRoutes(app)
registerMcpRoutes(app)

export default Sentry.withSentry(
  (env: Bindings) => ({
    ...(env.SENTRY_DSN ? { dsn: env.SENTRY_DSN } : {}),
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    ...(env.SENTRY_ENVIRONMENT ? { environment: env.SENTRY_ENVIRONMENT } : {}),
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
