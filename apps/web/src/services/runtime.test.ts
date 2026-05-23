import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/types'
import { ToolRegistry } from '@tinytinkerer/agent-core'
import { DEFAULT_MODEL } from './models.js'

// Mutable runtime settings — modified per test so the mock factory can close over them
const mockSettings = vi.hoisted(() => ({
  searchEnabled: true,
  selectedModel: 'openai/gpt-4.1-mini',
  showThinkingTimeline: true,
  showToolActivity: true
}))

const mockAuth = vi.hoisted(() => ({
  token: null as string | null
}))

vi.mock('../stores/settings-store.js', () => ({
  useSettingsStore: {
    getState: () => mockSettings
  }
}))

vi.mock('../stores/auth-store.js', () => ({
  useAuthStore: {
    getState: () => mockAuth
  }
}))

vi.mock('./config.js', () => ({
  edgeUrl: 'http://test-edge.local'
}))

import { getRuntime } from './runtime.js'

beforeEach(() => {
  mockSettings.searchEnabled = true
  mockSettings.selectedModel = 'openai/gpt-4.1-mini'
  mockAuth.token = null
})

describe('getRuntime — search tool registration', () => {
  it('registers web-search tool in the registry when searchEnabled is true', () => {
    mockSettings.searchEnabled = true
    const registerSpy = vi.spyOn(ToolRegistry.prototype, 'register')
    getRuntime()
    expect(registerSpy).toHaveBeenCalledTimes(1)
    const registeredTool = registerSpy.mock.calls[0]?.[0]
    expect(registeredTool?.id).toBe('web-search')
    registerSpy.mockRestore()
  })

  it('does not register any tools when searchEnabled is false', () => {
    mockSettings.searchEnabled = false
    const registerSpy = vi.spyOn(ToolRegistry.prototype, 'register')
    getRuntime()
    expect(registerSpy).not.toHaveBeenCalled()
    registerSpy.mockRestore()
  })
})

describe('getRuntime — model forwarding', () => {
  it('forwards selectedModel from settings store to the HTTP request body', async () => {
    let capturedBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string | undefined
        const sseBody = [
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          '',
          'data: [DONE]',
          ''
        ].join('\n')
        return Promise.resolve(
          new Response(sseBody, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      })
    )

    mockAuth.token = 'test-token'
    mockSettings.selectedModel = DEFAULT_MODEL

    const runtime = getRuntime()
    const events: unknown[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(capturedBody).toBeDefined()
    const requestBody = JSON.parse(capturedBody ?? '{}') as { model: string }
    expect(requestBody.model).toBe(DEFAULT_MODEL)

    vi.unstubAllGlobals()
  })

  it('creates a new AgentRuntime instance on every call (no shared state)', () => {
    const runtime1 = getRuntime()
    const runtime2 = getRuntime()
    expect(runtime1).not.toBe(runtime2)
  })

  it('normalizes unsupported selectedModel values before sending the request', async () => {
    let capturedBody: string | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string | undefined
        const sseBody = [
          'data: {"choices":[{"delta":{"content":"ok"}}]}',
          '',
          'data: [DONE]',
          ''
        ].join('\n')
        return Promise.resolve(
          new Response(sseBody, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' }
          })
        )
      })
    )

    mockAuth.token = 'test-token'
    mockSettings.selectedModel = 'openai/gpt-4o'

    const runtime = getRuntime()
    for await (const _event of runtime.run('hello')) {
      // drain event stream
    }

    expect(capturedBody).toBeDefined()
    const requestBody = JSON.parse(capturedBody ?? '{}') as { model: string }
    expect(requestBody.model).toBe(DEFAULT_MODEL)

    vi.unstubAllGlobals()
  })
})

describe('getRuntime — search disable behavior', () => {
  it('suppresses search planning and tool events when searchEnabled is false', async () => {
    mockSettings.searchEnabled = false

    const runtime = getRuntime()
    const events: ChatEvent[] = []
    for await (const event of runtime.run('latest news about React')) {
      events.push(event)
    }

    const generatedPlan = events.find((event) => event.type === 'plan.generated')
    expect(generatedPlan?.type).toBe('plan.generated')
    if (generatedPlan?.type !== 'plan.generated') {
      throw new Error('Expected plan.generated event')
    }

    expect(generatedPlan.payload.plan.steps.some((step) => step.id === 'search')).toBe(false)
    expect(events.some((event) => event.type === 'tool.call.started')).toBe(false)
    expect(events.some((event) => event.type === 'tool.call.completed')).toBe(false)
    expect(events.some((event) => event.type === 'tool.call.failed')).toBe(false)
  })
})
