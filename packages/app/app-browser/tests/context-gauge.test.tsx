// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Regression for the deployed-preview bug where the context-usage gauge hammered
// /api/models/list: `refreshModels` is a forced re-probe whose identity changes
// every render, so the fetch effect re-fired on its own state update forever
// whenever the selected model never resolved a context window. The hook must now
// fetch at most once per distinct selected model.

// A fresh refreshModels identity on every render reproduces the churn that drove
// the loop; all of them increment one shared counter so we can assert the total.
let refreshCallCount = 0
const modelsWithoutLimits = [
  { provider: 'litellm' as const, id: 'model-x', label: 'model-x', kind: 'chat' as const }
]

vi.mock('../src/models.js', () => ({
  useModels: () => ({
    models: modelsWithoutLimits,
    isRefreshing: false,
    refreshError: null,
    refreshModels: () => {
      refreshCallCount += 1
      return Promise.resolve(modelsWithoutLimits)
    }
  })
}))

vi.mock('../src/app.js', () => ({
  useChatStore: (selector: (state: { events: unknown[] }) => unknown) => selector({ events: [] }),
  useSettingsStore: (
    selector: (state: {
      selectedModel: string
      pluginActivation: Record<string, boolean>
    }) => unknown
  ) => selector({ selectedModel: 'model-x', pluginActivation: { 'ctx-plugin': true } })
}))

vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: () =>
    Promise.resolve([
      {
        manifest: {
          id: 'ctx-plugin',
          label: 'ctx',
          description: 'ctx',
          capabilities: ['status'],
          statusDescriptor: {
            id: 'ctx-plugin',
            gaugeType: 'context_usage',
            // Returns null (gauge hidden) — mirrors a selected model with no
            // known context window, the exact case that used to loop.
            summarizeStatus: () => null
          }
        },
        createPlugin: () => ({ id: 'ctx-plugin' })
      }
    ])
}))

import { useContextGauge } from '../src/context-gauge.js'

afterEach(() => {
  refreshCallCount = 0
})

describe('useContextGauge', () => {
  it('fetches the catalogue at most once when the model never resolves a context window', async () => {
    const { rerender, result } = renderHook(() => useContextGauge())

    // After the status plugin loads, the one allowed fetch fires.
    await waitFor(() => expect(refreshCallCount).toBe(1))

    // Re-render repeatedly: each render hands the effect a fresh refreshModels
    // identity (the loop trigger). The ref guard must keep the count at one.
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        rerender()
      })
    }

    expect(refreshCallCount).toBe(1)
    // No context window resolved, so the gauge stays hidden.
    expect(result.current).toBeNull()
  })
})
