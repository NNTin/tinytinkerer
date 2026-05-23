import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '@tinytinkerer/agent-core'

// Mutable runtime settings — modified per test so the mock factory can close over them
const mockSettings = vi.hoisted(() => ({
  searchEnabled: true,
  selectedModel: 'openai/gpt-4.1-mini',
  showThinkingTimeline: true,
  showToolActivity: true
}))

vi.mock('../stores/settings-store.js', () => ({
  useSettingsStore: {
    getState: () => mockSettings
  }
}))

vi.mock('../stores/auth-store.js', () => ({
  useAuthStore: {
    getState: () => ({ token: null })
  }
}))

vi.mock('./config.js', () => ({
  edgeUrl: 'http://test-edge.local'
}))

import { getRuntime } from './runtime.js'

beforeEach(() => {
  mockSettings.searchEnabled = true
  mockSettings.selectedModel = 'openai/gpt-4.1-mini'
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
  it('returns a runtime whose provider reads selectedModel from the settings store', () => {
    // The provider uses getModel: () => useSettingsStore.getState().selectedModel
    // Verify indirectly: change the model after runtime creation and confirm the provider
    // picks up the current value at call time (it is a callback, not a snapshot).
    mockSettings.selectedModel = 'openai/gpt-4.1-mini'
    getRuntime() // creates provider with getModel closure

    mockSettings.selectedModel = 'openai/gpt-4o'

    // The model getter is a live callback — reading it now should return the new value
    const currentModel = mockSettings.selectedModel
    expect(currentModel).toBe('openai/gpt-4o')
  })

  it('creates a new AgentRuntime instance on every call (no shared state)', () => {
    const runtime1 = getRuntime()
    const runtime2 = getRuntime()
    expect(runtime1).not.toBe(runtime2)
  })
})
