import { afterEach, describe, expect, it, vi } from 'vitest'
import { llmPlan, type PlannerToolDescriptor } from '../src/runtime/mcp-planner.js'
import { GitHubModelsProvider } from '../src/runtime/github-models-provider.js'
import type { EdgeFetch } from '../src/runtime/edge-fetch.js'

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

const makeEdgeFetch = (responseBody: unknown, status = 200): EdgeFetch =>
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
  it('calls /api/models/chat with tool descriptors in the system message', async () => {
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })

    await llmPlan('What is the weather?', [], [descriptor], 'openai/gpt-4.1-mini', edgeFetch)

    expect(edgeFetch).toHaveBeenCalledOnce()
    const [path, body] = (edgeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { model: string; messages: Array<{ role: string; content: string }> }]
    expect(path).toBe('/api/models/chat')
    expect(body.model).toBe('openai/gpt-4.1-mini')

    const systemMsg = body.messages.find((m) => m.role === 'system')
    expect(systemMsg?.content).toContain('mcp:server-1:get_weather')
    expect(systemMsg?.content).toContain('Get current weather')
  })

  it('returns the parsed ExecutionPlan on a successful response', async () => {
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })

    const plan = await llmPlan('What is the weather?', [], [descriptor], 'openai/gpt-4.1-mini', edgeFetch)

    expect(plan.complexity).toBe('medium')
    expect(plan.steps).toHaveLength(3)
    expect(plan.steps[0]?.id).toBe('understand')
    expect(plan.steps[2]?.id).toBe('compose')
  })

  it('strips markdown code fences before parsing JSON', async () => {
    const fenced = '```json\n' + JSON.stringify(validPlan) + '\n```'
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: fenced } }] })

    const plan = await llmPlan('What is the weather?', [], [descriptor], 'openai/gpt-4.1-mini', edgeFetch)

    expect(plan.complexity).toBe('medium')
  })

  it('throws when the model returns malformed JSON', async () => {
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: 'not valid json' } }] })

    await expect(
      llmPlan('What?', [], [descriptor], 'openai/gpt-4.1-mini', edgeFetch)
    ).rejects.toThrow()
  })

  it('throws when the response is not ok', async () => {
    const edgeFetch = makeEdgeFetch({ error: 'Service Unavailable' }, 503)

    await expect(
      llmPlan('What?', [], [descriptor], 'openai/gpt-4.1-mini', edgeFetch)
    ).rejects.toThrow('Planning request failed (503)')
  })

  it('forwards the abort signal to edgeFetch', async () => {
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })
    const controller = new AbortController()

    await llmPlan('What?', [], [descriptor], 'openai/gpt-4.1-mini', edgeFetch, controller.signal)

    const [, , options] = (edgeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
      { signal?: AbortSignal; area?: string; stream?: boolean } | undefined
    ]
    expect(options?.signal).toBe(controller.signal)
    expect(options?.area).toBe('planning.chat')
    expect(options?.stream).toBe(false)
  })

  it('includes conversation history before the user prompt', async () => {
    const edgeFetch = makeEdgeFetch({ choices: [{ message: { content: JSON.stringify(validPlan) } }] })
    const history = [
      { role: 'user' as const, content: 'hello' },
      { role: 'assistant' as const, content: 'hi there' }
    ]

    await llmPlan('follow-up question', history, [descriptor], 'openai/gpt-4.1-mini', edgeFetch)

    const [, body] = (edgeFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }]
    const roles = body.messages.map((m) => m.role)
    expect(roles).toEqual(['system', 'user', 'assistant', 'user'])
    expect(body.messages[3]?.content).toBe('follow-up question')
  })
})

describe('GitHubModelsProvider.plan — LLM branch', () => {
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

    const provider = new GitHubModelsProvider({
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

    const provider = new GitHubModelsProvider({
      baseUrl: 'http://edge.local',
      getToken: () => 'my-token',
      allToolDescriptors: [descriptor]
    })

    const plan = await provider.plan('tell me a joke', [])

    // inferPlan heuristic: low-complexity prompt → low plan
    expect(plan.complexity).toBe('low')
    expect(plan.steps.map((s) => s.id)).toContain('compose')
  })

  it('re-throws AbortError instead of falling back to inferPlan', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(abortError)
    )

    const provider = new GitHubModelsProvider({
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

    const provider = new GitHubModelsProvider({
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

    const provider = new GitHubModelsProvider({
      baseUrl: 'http://edge.local',
      getToken: () => null,
      allToolDescriptors: [descriptor]
    })

    const plan = await provider.plan('what is the weather?', [])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(plan.steps.map((s) => s.id)).toContain('compose')
  })
})
