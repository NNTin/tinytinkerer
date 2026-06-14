import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { DEFAULT_MODEL } from '@tinytinkerer/app-core'
import type { BrowserShell } from '../src/shell.js'
import type { AuthStore } from '../src/stores/auth-store.js'
import type { SettingsStore } from '../src/stores/settings-store.js'
import type { StatusStore } from '../src/stores/status-store.js'
import { createBrowserRuntimeFactory } from '../src/runtime/get-runtime.js'

const mockSettings = {
  searchEnabled: true,
  selectedModel: 'openai/gpt-4.1-mini',
  agentType: 'plan-execute' as const,
  // Empty = the deployment-default sentinel: request bodies omit litellmBaseUrl.
  litellmBaseUrl: ''
}

const mockAuth = {
  token: null as string | null
}

const mockStatus = {
  hydrated: true,
  status: {
    auth: { state: 'ready', detail: 'ok' },
    models: { state: 'ready', detail: 'ok' },
    search: { state: 'ready', detail: 'ok' }
  }
}

const createAuthStoreStub = (): AuthStore =>
  ({
    getState: () => mockAuth
  }) as AuthStore

const createSettingsStoreStub = (): SettingsStore =>
  ({
    getState: () => mockSettings
  }) as SettingsStore

const createStatusStoreStub = (): StatusStore =>
  ({
    getState: () => mockStatus
  }) as StatusStore

const toRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input
  }

  if (input instanceof URL) {
    return input.href
  }

  return input.url
}

beforeEach(() => {
  mockSettings.searchEnabled = true
  mockSettings.selectedModel = DEFAULT_MODEL
  mockSettings.litellmBaseUrl = ''
  mockAuth.token = null
  mockStatus.hydrated = true
  mockStatus.status.search.state = 'ready'
  mockStatus.status.search.detail = 'ok'
})

describe('createBrowserRuntimeFactory', () => {
  // createRuntime is defined here so each test body calls it after beforeEach resets the mocks.
  // searchEnabled is read at .create() time, so runtime construction must happen inside the test.
  const createRuntime = () =>
    createBrowserRuntimeFactory({
      shell: {
        config: {
          edgeBaseUrl: 'http://test-edge.local',
          storageNamespace: 'tinytinkerer-test',
          authMode: 'hybrid',
          hostToken: null
        }
      } as BrowserShell,
      authStore: createAuthStoreStub(),
      settingsStore: createSettingsStoreStub(),
      statusStore: createStatusStoreStub()
    }).create()

  it('emits web-search tool events when searchEnabled is true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = toRequestUrl(input)
        if (url.endsWith('/api/search')) {
          return Promise.resolve(
            new Response(JSON.stringify({ query: 'latest news about React', results: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' }
            })
          )
        }

        throw new Error(`Unexpected fetch call: ${url}`)
      })
    )

    const runtime = createRuntime()
    const events: ChatEvent[] = []
    for await (const event of runtime.run('latest news about React')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'agent.tool.started')).toBe(true)
    expect(events.some((event) => event.type === 'agent.tool.completed')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('does not emit tool events when searchEnabled is false', async () => {
    mockSettings.searchEnabled = false
    const runtime = createRuntime()
    const events: ChatEvent[] = []
    for await (const event of runtime.run('latest news about React')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'agent.tool.started')).toBe(false)
  })

  it('does not emit tool events when the service is not ready', async () => {
    mockStatus.status.search.state = 'degraded'
    const runtime = createRuntime()
    const events: ChatEvent[] = []
    for await (const event of runtime.run('latest news about React')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'agent.tool.started')).toBe(false)
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
    const runtime = createRuntime()
    const events: unknown[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(capturedBody).toBeDefined()
    expect((JSON.parse(capturedBody ?? '{}') as { model: string }).model).toBe(DEFAULT_MODEL)
    vi.unstubAllGlobals()
  })

  it('reads provider, model, and token from live settings after runtime creation', async () => {
    let capturedBody: string | undefined
    let capturedAuthorization: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string | undefined
        capturedAuthorization = new Headers(init?.headers).get('authorization')
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

    mockSettings.selectedModel = DEFAULT_MODEL
    mockAuth.token = 'github-token'
    const runtime = createRuntime()

    mockSettings.selectedModel = 'anthropic/claude-3.5-sonnet'
    mockSettings.litellmBaseUrl = 'https://litellm.example.com/'
    mockAuth.token = 'rotated-token'

    const events: unknown[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(capturedAuthorization).toBe('Bearer rotated-token')
    expect(
      JSON.parse(capturedBody ?? '{}') as {
        model: string
        litellmBaseUrl: string
      }
    ).toMatchObject({
      model: 'anthropic/claude-3.5-sonnet',
      litellmBaseUrl: 'https://litellm.example.com/'
    })
    vi.unstubAllGlobals()
  })

  it('forwards the model, GitHub token, and base URL', async () => {
    let capturedBody: string | undefined
    let capturedAuthorization: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = init?.body as string | undefined
        capturedAuthorization = new Headers(init?.headers).get('authorization')
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

    mockSettings.selectedModel = 'openai/gpt-5'
    mockSettings.litellmBaseUrl = 'https://litellm.example.com/'
    mockAuth.token = 'github-token'

    const runtime = createRuntime()
    const events: unknown[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    expect(capturedAuthorization).toBe('Bearer github-token')
    expect(
      JSON.parse(capturedBody ?? '{}') as {
        model: string
        litellmBaseUrl: string
      }
    ).toMatchObject({
      model: 'openai/gpt-5',
      litellmBaseUrl: 'https://litellm.example.com/'
    })
    vi.unstubAllGlobals()
  })

  it('omits litellmBaseUrl from the request body when no base URL is configured (issue #179)', async () => {
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

    mockSettings.selectedModel = 'openai/gpt-5'
    mockSettings.litellmBaseUrl = ''
    mockAuth.token = 'github-token'

    const runtime = createRuntime()
    const events: unknown[] = []
    for await (const event of runtime.run('hello')) {
      events.push(event)
    }

    // The deployment-default sentinel must leave the field off the wire so
    // the edge resolves its own configured LITELLM_BASE_URL.
    const body = JSON.parse(capturedBody ?? '{}') as Record<string, unknown>
    expect(body).toMatchObject({ model: 'openai/gpt-5' })
    expect(body).not.toHaveProperty('provider')
    expect(body).not.toHaveProperty('litellmBaseUrl')
    vi.unstubAllGlobals()
  })

  it('suppresses search planning and tool events when searchEnabled is false', async () => {
    mockSettings.searchEnabled = false

    const runtime = createRuntime()
    const events: ChatEvent[] = []
    for await (const event of runtime.run('latest news about React')) {
      events.push(event)
    }

    // With search disabled no web-search tool is registered, so the inferred
    // plan has no search step and no tool runs.
    expect(events.some((event) => event.type === 'agent.run.started')).toBe(true)
    expect(events.some((event) => event.type === 'agent.tool.started')).toBe(false)
  })

  it('suppresses search planning when the service is unavailable', async () => {
    mockStatus.status.search.state = 'offline'

    const runtime = createRuntime()
    const events: ChatEvent[] = []
    for await (const event of runtime.run('latest news about React')) {
      events.push(event)
    }

    expect(events.some((event) => event.type === 'agent.run.started')).toBe(true)
    expect(events.some((event) => event.type === 'agent.tool.started')).toBe(false)
  })
})
