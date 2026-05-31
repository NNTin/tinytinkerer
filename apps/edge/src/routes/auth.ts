import { zValidator } from '@hono/zod-validator'
import { githubExchangeRequestSchema, githubExchangeResponseSchema } from '@tinytinkerer/contracts'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { Bindings } from '../lib/bindings'
import { fetchWithTimeout } from '../lib/fetch'

const githubOAuthResponseSchema = z.object({
  access_token: z.string().optional(),
  error: z.string().optional()
})

const GITHUB_CODE_RE = /^[a-zA-Z0-9_-]{10,40}$/

export const registerAuthRoutes = (app: Hono<{ Bindings: Bindings }>) => {
  app.post('/auth/github/exchange', zValidator('json', githubExchangeRequestSchema), async (c) => {
    const { code, redirectUri } = c.req.valid('json')

    if (!GITHUB_CODE_RE.test(code)) {
      return c.json(githubExchangeResponseSchema.parse({ error: 'Invalid OAuth code format' }), 400)
    }

    if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
      return c.json(githubExchangeResponseSchema.parse({ error: 'OAuth is not configured' }), 501)
    }

    const response = await fetchWithTimeout(
      {
        area: 'auth.exchange',
        origin: 'github',
        method: 'POST',
        url: 'https://github.com/login/oauth/access_token'
      },
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          client_id: c.env.GITHUB_CLIENT_ID,
          client_secret: c.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri
        })
      },
      10_000
    )

    const parsed = githubOAuthResponseSchema.safeParse(await response.json())
    const payload = parsed.success ? parsed.data : {}

    if (!payload.access_token) {
      return c.json(
        githubExchangeResponseSchema.parse({
          error: payload.error ?? 'OAuth exchange failed'
        }),
        400
      )
    }

    return c.json(githubExchangeResponseSchema.parse({ accessToken: payload.access_token }))
  })
}
