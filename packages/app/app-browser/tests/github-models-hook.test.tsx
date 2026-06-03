// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderId } from '@tinytinkerer/contracts'

const mockState = vi.hoisted((): {
  auth: { token: string | null }
  settings: {
    selectedModelProvider: ModelProviderId
    openRouterApiKey: string | null
  }
} => ({
  auth: { token: null },
  settings: {
    selectedModelProvider: 'github',
    openRouterApiKey: null
  }
}))

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

import { useGitHubModels } from '../src/github-models.js'

describe('useGitHubModels', () => {
  beforeEach(() => {
    mockState.auth.token = null
    mockState.settings.selectedModelProvider = 'github'
    mockState.settings.openRouterApiKey = null
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('clears provider-specific refresh state when the selected provider changes', async () => {
    const { result, rerender } = renderHook(
      ({ selectedModel }) => useGitHubModels(selectedModel),
      { initialProps: { selectedModel: 'openai/gpt-5' } }
    )

    await act(async () => {
      await result.current.refreshGitHubModels()
    })

    expect(result.current.refreshError).toBe(
      'Sign in with GitHub to refresh models.'
    )

    mockState.settings.selectedModelProvider = 'openrouter'
    rerender({ selectedModel: 'openai/gpt-4.1-mini' })

    await waitFor(() => {
      expect(result.current.refreshError).toBeNull()
      expect(result.current.isRefreshing).toBe(false)
      expect(result.current.models).toEqual([
        {
          provider: 'openrouter',
          id: 'openai/gpt-4.1-mini',
          label: 'openai/gpt-4.1-mini',
          kind: 'chat'
        }
      ])
    })
  })
})
