import { describe, expect, it, vi } from 'vitest'
import { RateLimitError, type ExecutionContext } from '@tinytinkerer/agent-core'
import { GitHubModelsProvider } from '../src/runtime/github-models-provider.js'

const context: ExecutionContext = {
  prompt: 'hello',
  history: [],
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
  it('returns a low-complexity plan for a plain prompt', async () => {
    const provider = new GitHubModelsProvider({ baseUrl: 'http://example.com' })
    const plan = await provider.plan('tell me a joke')
    expect(plan.complexity).toBe('low')
    expect(plan.steps.map((step) => step.id)).toEqual(['understand', 'compose'])
  })

  it('returns a medium-complexity plan with a search step for search-keyword prompts', async () => {
    const provider = new GitHubModelsProvider({ baseUrl: 'http://example.com' })
    const plan = await provider.plan('what is the latest news today?')
    expect(plan.complexity).toBe('medium')
    expect(plan.steps.map((step) => step.id)).toEqual(['understand', 'search', 'compose'])
    expect(plan.steps[1]?.toolCall?.toolId).toBe('web-search')
  })

  it('throws a typed rate limit error for 429 responses', async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 'rate_limited',
            error: 'rate limited',
            retryAfterMs: 120_000,
            retryAt
          }),
          {
            status: 429,
            headers: { 'retry-after': '120' }
          }
        )
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

  it('includes prior conversation turns before the current prompt', async () => {
    const fetchSpy = vi.fn(async () => {
      const body = [
        'data: {"choices":[{"delta":{"content":"ok"}}]}',
        '',
        'data: [DONE]',
        ''
      ].join('\n')
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const provider = new GitHubModelsProvider({
      baseUrl: 'http://example.com',
      getToken: () => 'token'
    })

    const output = await collect(
      provider.synthesize({
        ...context,
        prompt: 'Do you know my name?',
        history: [
          { role: 'user', content: 'hello, my name is Tin' },
          { role: 'assistant', content: 'Hello Tin! How can I assist you today?' }
        ],
        notes: ['understand: user is asking about stored name'],
        toolResults: { search: { result: 'Tin' } }
      })
    )

    expect(output).toBe('ok')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [, init] = fetchSpy.mock.calls[0] ?? []
    const requestBody = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>
    }

    expect(requestBody.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: 'hello, my name is Tin' },
      { role: 'assistant', content: 'Hello Tin! How can I assist you today?' },
      {
        role: 'user',
        content: [
          'Do you know my name?',
          '\nResearch notes:\nunderstand: user is asking about stored name',
          '\nTool results:\nsearch: {"result":"Tin"}'
        ].join('')
      }
    ])

    vi.unstubAllGlobals()
  })
})
