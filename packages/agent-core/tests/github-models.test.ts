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

describe('GitHubModelsProvider.plan', () => {
  it('returns a low-complexity plan for a plain prompt', async () => {
    const provider = new GitHubModelsProvider({ baseUrl: 'http://example.com' })
    const plan = await provider.plan('tell me a joke')
    expect(plan.complexity).toBe('low')
    expect(plan.steps.map((s) => s.id)).toEqual(['understand', 'compose'])
  })

  it('returns a medium-complexity plan with a search step for search-keyword prompts', async () => {
    const provider = new GitHubModelsProvider({ baseUrl: 'http://example.com' })
    const plan = await provider.plan('what is the latest news today?')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.map((s) => s.id)).toEqual(['understand', 'search', 'compose'])
    expect(plan.steps[1]?.toolCall?.toolId).toBe('web-search')
  })

  it('does not make network calls', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const provider = new GitHubModelsProvider({ baseUrl: 'http://example.com' })
    await provider.plan('does this hit the network?')
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('GitHubModelsProvider.execute', () => {
  const provider = new GitHubModelsProvider({ baseUrl: 'http://example.com' })

  it('returns a tool result summary for tool steps', async () => {
    const ctx: ExecutionContext = {
      ...context,
      toolResults: { search: { count: 3, items: ['a', 'b', 'c'] } }
    }
    const note = await provider.execute(
      { id: 'search', summary: 'Search web', toolCall: { toolId: 'web-search', input: {} } },
      ctx
    )
    expect(note).toBe('search: {"count":3,"items":["a","b","c"]}')
    expect(note).not.toContain('Completed step:')
  })

  it('returns empty string for tool steps with no result yet', async () => {
    const note = await provider.execute(
      { id: 'search', summary: 'Search web', toolCall: { toolId: 'web-search', input: {} } },
      context
    )
    expect(note).toBe('')
  })

  it('returns empty string for non-tool steps', async () => {
    const note = await provider.execute({ id: 'understand', summary: 'Understand the request' }, context)
    expect(note).toBe('')
    expect(note).not.toContain('Completed step:')
  })

  it('does not return placeholder text', async () => {
    const composeNote = await provider.execute({ id: 'compose', summary: 'Compose final response' }, context)
    expect(composeNote).not.toMatch(/Completed step:/i)
  })
})

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
