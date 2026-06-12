import { afterEach, describe, expect, it, vi } from 'vitest'
import { llmPlan, type PlannerToolDescriptor } from '../src/runtime/mcp-planner.js'
import { LiteLLMProvider } from '../src/runtime/litellm-provider.js'
import type { ModelsChatFetch } from '../src/runtime/edge-fetch.js'

const descriptor: PlannerToolDescriptor = {
  id: 'mcp:server-1:get_weather',
  description: '[MyServer] Get current weather',
  inputSchema: { location: { type: 'string' } }
}

const validPlan = {
  complexity: 'medium',
  steps: [
    { id: 'understand', summary: 'Parse the request' },
    { id: 'mcp:server-1:get_weather', summary: 'Get weather data', toolCall: { toolId: 'mcp:server-1:get_weather', input: { location: 'Berlin' } } },
    { id: 'compose', summary: 'Write the answer' }
  ]
}

const makeModelsChat = (responseBody: unknown, status = 200): ModelsChatFetch =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('llmPlan', () => {
  it('requests a plan with tool descriptors in the system message', async () => {
    const modelsChat = makeModelsChat({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })

    await llmPlan('What is the weather?', [], [descriptor], 'openai/gpt-4.1-mini', modelsChat)

    expect(modelsChat).toHaveBeenCalledOnce()
    const [init] = (modelsChat as ReturnType<typeof vi.fn>).mock.calls[0] as [{ model: string; stream: boolean; messages: Array<{ role: string; content: string }> }]
    expect(init.model).toBe('openai/gpt-4.1-mini')
    expect(init.stream).toBe(false)

    const systemMsg = init.messages.find((m) => m.role === 'system')
    expect(systemMsg?.content).toContain('mcp:server-1:get_weather')
    expect(systemMsg?.content).toContain('Get current weather')
  })

  it('returns the parsed ExecutionPlan on a successful response', async () => {
    const modelsChat = makeModelsChat({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })

    const plan = await llmPlan('What is the weather?', [], [descriptor], 'openai/gpt-4.1-mini', modelsChat)

    expect(plan.complexity).toBe('medium')
    expect(plan.steps).toHaveLength(3)
    expect(plan.steps[0]?.id).toBe('understand')
    expect(plan.steps[2]?.id).toBe('compose')
  })

  it('strips markdown code fences before parsing JSON', async () => {
    const fenced = '```json\n' + JSON.stringify(validPlan) + '\n```'
    const modelsChat = makeModelsChat({ choices: [{ message: { content: fenced } }] })

    const plan = await llmPlan('What is the weather?', [], [descriptor], 'openai/gpt-4.1-mini', modelsChat)

    expect(plan.complexity).toBe('medium')
  })

  it('throws when the model returns malformed JSON', async () => {
    const modelsChat = makeModelsChat({ choices: [{ message: { content: 'not valid json' } }] })

    await expect(
      llmPlan('What?', [], [descriptor], 'openai/gpt-4.1-mini', modelsChat)
    ).rejects.toThrow()
  })

  it('throws when the response is not ok', async () => {
    const modelsChat = makeModelsChat({ error: 'Service Unavailable' }, 503)

    await expect(
      llmPlan('What?', [], [descriptor], 'openai/gpt-4.1-mini', modelsChat)
    ).rejects.toThrow('Planning request failed (503)')
  })

  it('throws a typed rate limit error when the planner is rate limited', async () => {
    const retryAt = new Date(Date.now() + 120_000).toISOString()
    const modelsChat = makeModelsChat(
      {
        code: 'rate_limited',
        error: 'planner limited',
        retryAfterMs: 120_000,
        retryAt
      },
      429
    )

    await expect(
      llmPlan('What?', [], [descriptor], 'openai/gpt-4.1-mini', modelsChat)
    ).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfterMs: 120_000,
      retryAt
    })
  })

  it('forwards the abort signal to the models/chat call', async () => {
    const modelsChat = makeModelsChat({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })
    const controller = new AbortController()

    await llmPlan('What?', [], [descriptor], 'openai/gpt-4.1-mini', modelsChat, controller.signal)

    const [, options] = (modelsChat as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      { signal?: AbortSignal; area?: string } | undefined
    ]
    expect(options?.signal).toBe(controller.signal)
    expect(options?.area).toBe('planning.chat')
  })

  it('includes conversation history before the user prompt', async () => {
    const modelsChat = makeModelsChat({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })
    const history = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi there' }
    ]

    await llmPlan('follow-up question', history, [descriptor], 'openai/gpt-4.1-mini', modelsChat)

    const [init] = (modelsChat as ReturnType<typeof vi.fn>).mock.calls[0] as [{ messages: Array<{ role: string; content: string }> }]
    const roles = init.messages.map((m) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'user'])
    expect(init.messages[3]?.content).toBe('follow-up question')
  })
})

describe('LiteLLMProvider.plan — LLM branch', () => {
  it('calls llmPlan when a token is present and MCP tools are in allToolDescriptors', async () => {
    const planJson = JSON.stringify({
      complexity: 'low',
      steps: [{ id: 'understand', summary: 'ok' }, { id: 'compose', summary: 'ok' }]
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: planJson } }] }), { status: 200 })
      )
    )

    const provider = new LiteLLMProvider({
      baseUrl: 'http://edge.local',
      getToken: () => 'my-token',
      allToolDescriptors: [descriptor]
    })

    const plan = await provider.plan('what is the weather?', [])

    expect(plan.complexity).toBe('low')
    // fetch was called for llmPlan (non-streaming models/chat)
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
    const [url] = vi.mocked(fetch).mock.calls[0] as [string]
    expect(url).toContain('/api/models/chat')
  })

  it('falls back to inferPlan when llmPlan throws a non-abort error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error'))
    )

    const provider = new LiteLLMProvider({
      baseUrl: 'http://edge.local',
      getToken: () => 'my-token',
      allToolDescriptors: [descriptor]
    })

    const plan = await provider.plan('tell me a joke', [])

    // inferPlan heuristic: low-complexity prompt → low plan
    expect(plan.complexity).toBe('low')
    expect(plan.steps.map((s) => s.id)).toContain('compose')
  })

  it('surfaces a model-content parse failure instead of degrading to a guessed plan', async () => {
    // A 200 response whose model `content` is prose, not JSON. A wrong/guessed
    // plan is worse than a clear failure, so this must propagate (issue #139) —
    // NOT silently fall back to the heuristic inferPlan.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'I cannot plan this.' } }] }),
          { status: 200 }
        )
      )
    )

    const provider = new LiteLLMProvider({
      baseUrl: 'http://edge.local',
      getToken: () => 'my-token',
      allToolDescriptors: [descriptor]
    })

    await expect(provider.plan('what is the weather?', [])).rejects.toMatchObject({
      name: 'ModelJsonError',
      kind: 'parse_error'
    })
  })

  it('re-throws AbortError instead of falling back to inferPlan', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(abortError)
    )

    const provider = new LiteLLMProvider({
      baseUrl: 'http://edge.local',
      getToken: () => 'my-token',
      allToolDescriptors: [descriptor]
    })

    await expect(provider.plan('what is the weather?', [])).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('calls llmPlan when a token is present and web-search is the only available tool', async () => {
    const planJson = JSON.stringify({
      complexity: 'low',
      steps: [{ id: 'understand', summary: 'ok' }, { id: 'compose', summary: 'ok' }]
    })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: planJson } }] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const provider = new LiteLLMProvider({
      baseUrl: 'http://edge.local',
      getToken: () => 'my-token',
      allToolDescriptors: [{ id: 'web-search', description: 'Search the web', inputSchema: {} }]
    })

    const plan = await provider.plan('tell me a joke', [])

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('/api/models/chat')
    expect(plan.complexity).toBe('low')
  })

  it('falls back to inferPlan when no token is available', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const provider = new LiteLLMProvider({
      baseUrl: 'http://edge.local',
      getToken: () => null,
      allToolDescriptors: [descriptor]
    })

    const plan = await provider.plan('what is the weather?', [])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(plan.steps.map((s) => s.id)).toContain('compose')
  })
})
