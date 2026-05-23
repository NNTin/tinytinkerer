import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'

const mockSettings = vi.hoisted(() => ({
  searchEnabled: true,
  selectedModel: 'openai/gpt-4.1-mini'
}))

const mockAuth = vi.hoisted(() => ({
  token: null as string | null
}))

vi.mock('../src/stores/settings-store.js', () => ({
  useSettingsStore: {
    getState: () => mockSettings
  }
}))

vi.mock('../src/stores/auth-store.js', () => ({
  useAuthStore: {
    getState: () => mockAuth
  }
}))

import { ToolRegistry } from '@tinytinkerer/agent-core'
import { DEFAULT_MODEL } from '@tinytinkerer/app-core'
import { initializeBrowserShell } from '../src/shell.js'
import { getRuntime } from '../src/runtime/get-runtime.js'

beforeEach(() => {
  mockSettings.searchEnabled = true
  mockSettings.selectedModel = DEFAULT_MODEL
  mockAuth.token = null
  initializeBrowserShell({
    edgeBaseUrl: 'http://test-edge.local',
    storageNamespace: 'tinytinkerer-test'
  })
})

describe('getRuntime', () => {
  it('registers web-search tool in the registry when searchEnabled is true', () => {
    const registerSpy = vi.spyOn(ToolRegistry.prototype, 'register')
    getRuntime()
    expect(registerSpy).toHaveBeenCalledTimes(1)
    expect(registerSpy.mock.calls[0]?.[0]?.id).toBe('web-search')
    registerSpy.mockRestore()
  })

  it('does not register any tools when searchEnabled is false', () => {
    mockSettings.searchEnabled = false
    const registerSpy = vi.spyOn(ToolRegistry.prototype, 'register')
    getRuntime()
    expect(registerSpy).not.toHaveBeenCalled()
    registerSpy.mockRestore()
  })

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
    const runtime = getRuntime()
    const events: unknown[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(capturedBody).toBeDefined()
    expect((JSON.parse(capturedBody ?? '{}') as { model: string }).model).toBe(DEFAULT_MODEL)
    vi.unstubAllGlobals()
  })

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
  })
})
