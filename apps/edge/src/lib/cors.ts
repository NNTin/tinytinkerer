import type { MiddlewareHandler } from 'hono'
import type { Bindings } from './bindings'

export const corsMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const origin = c.env.ALLOWED_ORIGIN ?? '*'

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
      }
    })
  }

  await next()
  c.res.headers.set('Access-Control-Allow-Origin', origin)
  if (origin !== '*') {
    c.res.headers.append('Vary', 'Origin')
  }
}
