import { afterEach, describe, expect, it, vi } from 'vitest'
import app from './index.js'

describe('edge routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a typed 503 error when search is unavailable', async () => {
    const response = await app.fetch(
      new Request('http://localhost/api/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'latest ai news' })
      }),
      {}
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'Web search is currently unavailable. Configure Tavily to enable live search.'
    })
  })

  it('returns a typed models error for upstream authentication failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('upstream unauthorized', {
            status: 401,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )

    const response = await app.fetch(
      new Request('http://localhost/api/models/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4.1-mini',
          stream: true,
          messages: [{ role: 'user', content: 'hello' }]
        })
      }),
      {}
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication failed. Your GitHub token may be invalid or expired.'
    })
  })
})
