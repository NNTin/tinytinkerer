// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_MODELS } from '@tinytinkerer/app-core'

const mockState = vi.hoisted(
  (): {
    auth: { token: string | null }
    settings: { litellmBaseUrl: string }
  } => ({
    auth: { token: null },
    // Empty = the deployment-default sentinel: requests omit litellmBaseUrl.
    settings: { litellmBaseUrl: '' }
  })
)

vi.mock('../src/app.js', () => ({
  useAuthStore: <T,>(selector: (state: typeof mockState.auth) => T): T =>
    selector(mockState.auth),
  useSettingsStore: <T,>(selector: (state: typeof mockState.settings) => T): T =>
    selector(mockState.settings)
}))

vi.mock('../src/hooks.js', () => ({
  useBrowserShellConfig: () => ({ edgeBaseUrl: 'https://edge.example.com' })
}))

vi.mock('../src/telemetry/telemetry.js', async () => {
  const actual = await vi.importActual<typeof import('../src/telemetry/telemetry.js')>(
    '../src/telemetry/telemetry.js'
  )
  return {
    ...actual,
    getTelemetryHeaders: () => ({})
  }
})

import { clearModelsCache, useModels } from '../src/models.js'

describe('useModels', () => {
  beforeEach(() => {
    mockState.auth.token = null
    mockState.settings.litellmBaseUrl = ''
    clearModelsCache()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('serves the built-in fallback on mount without a network call', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useModels('openai/gpt-5'))

    expect(result.current.models).toEqual([...FALLBACK_MODELS])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('asks the user to sign in when refreshing without a token', async () => {
    const { result } = renderHook(() => useModels('openai/gpt-5'))

    await act(async () => {
      await result.current.refreshModels()
    })

    expect(result.current.refreshError).toBe(
      'Sign in with GitHub to refresh models.'
    )
  })

  it('refreshes against the edge with the litellm provider, omitting the base URL when unset', async () => {
    mockState.auth.token = 'gh-token'
    const models = [
      {
        provider: 'litellm',
        id: 'openai/gpt-4.1-mini',
        label: 'openai/gpt-4.1-mini',
        kind: 'chat'
      }
    ]
    let capturedUrl = ''
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      capturedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      return Promise.resolve(
        new Response(JSON.stringify({ models }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useModels())

    await act(async () => {
      await result.current.refreshModels()
    })

    expect(result.current.refreshError).toBeNull()
    expect(result.current.models).toEqual(models)
    expect(capturedUrl).toContain('provider=litellm')
    // No explicit base URL configured: the request must omit the param so the
    // edge resolves its own configured deployment default (issue #179).
    expect(capturedUrl).not.toContain('litellmBaseUrl')
  })

  it('sends the base URL when the user explicitly configured one', async () => {
    mockState.auth.token = 'gh-token'
    mockState.settings.litellmBaseUrl = 'https://litellm.example.com/'
    let capturedUrl = ''
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      capturedUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      return Promise.resolve(
        new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useModels())

    await act(async () => {
      await result.current.refreshModels()
    })

    expect(capturedUrl).toContain(
      'litellmBaseUrl=https%3A%2F%2Flitellm.example.com%2F'
    )
  })

  it('surfaces a soft message instead of silently serving the fallback when the refresh fails (issue #179)', async () => {
    mockState.auth.token = 'gh-token'
    // Edge down/cooldown: fetchModels degrades to the fallback list, which
    // used to leave refreshError null — the button spun and stopped with no
    // feedback.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('cooldown', { status: 503 })))
    )

    const { result } = renderHook(() => useModels())

    await act(async () => {
      await result.current.refreshModels()
    })

    expect(result.current.models).toEqual([...FALLBACK_MODELS])
    expect(result.current.refreshError).toBe(
      "Couldn't refresh models — showing the last-known list."
    )
  })
})
