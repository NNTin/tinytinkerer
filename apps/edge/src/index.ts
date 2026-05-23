import { Hono } from 'hono'
import type { Bindings } from './lib/bindings'
import { corsMiddleware } from './lib/cors'
import { registerAuthRoutes } from './routes/auth'
import { registerHealthRoute } from './routes/health'
import { registerModelRoutes } from './routes/models'
import { registerSearchRoutes } from './routes/search'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', corsMiddleware)

registerHealthRoute(app)
registerAuthRoutes(app)
registerSearchRoutes(app)
registerModelRoutes(app)

export default app
