import { describe, expect, it, vi } from 'vitest'
import { RateLimitError } from '../src/errors/rate-limit-error'
import { GitHubModelsProvider } from '../src/providers/github-models'
import type { ExecutionContext } from '../src/types'

const context: ExecutionContext = {
  prompt: 'hello',
  plan: { complexity: 'low', steps: [] },
  notes: [],
  toolResults: {}
}

const collect = async (stream: AsyncIterable<string>): Promise<string> => {
  let output = ''
  for await (const chunk of stream) {
    output += chunk
  }
  return output
}

describe('GitHubModelsProvider', () => {
  it('throws a typed rate limit error for 429 responses', async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'rate limited', retryAfterMs: 120_000, retryAt }), {
          status: 429,
          headers: { 'retry-after': '120' }
        })
      )
    )

    const provider = new GitHubModelsProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token'
    })

    await expect(collect(provider.synthesize(context))).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfterMs: 120_000,
      retryAt
    } satisfies Partial<RateLimitError>)

    vi.unstubAllGlobals()
  })

  it('falls back to retry-after header when response body has no metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('Too many requests', {
          status: 429,
          headers: { 'retry-after': '3' }
        })
      )
    )

    const provider = new GitHubModelsProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token'
    })

    await expect(collect(provider.synthesize(context))).rejects.toMatchObject({
      retryAfterMs: 3_000
    } satisfies Partial<RateLimitError>)

    vi.unstubAllGlobals()
  })
})
