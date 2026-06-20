import { isPluginModule } from '@tinytinkerer/contracts'
import { describe, expect, it } from 'vitest'
import * as contextUsageModule from '../src/index'
import {
  CONTEXT_USAGE_PLUGIN_ID,
  computeContextGauge,
  contextUsagePlugin,
  contextUsagePluginManifest,
  thresholdForPercent
} from '../src/index'

describe('computeContextGauge', () => {
  it('computes percent, remaining, and gauge geometry', () => {
    const view = computeContextGauge({ contextWindow: 1000, inputTokensUsed: 250 })
    expect(view).not.toBeNull()
    expect(view).toMatchObject({
      gauge_type: 'context_usage',
      value: 25,
      min: 0,
      max: 100,
      unit: 'percent',
      threshold: 'healthy',
      context: {
        context_window: 1000,
        input_tokens_used: 250,
        input_tokens_remaining: 750,
        percent_context_used: 25
      }
    })
  })

  it('buckets thresholds at the documented boundaries (<70 / 70-90 / >90)', () => {
    expect(thresholdForPercent(0)).toBe('healthy')
    expect(thresholdForPercent(69)).toBe('healthy')
    expect(thresholdForPercent(70)).toBe('warning')
    expect(thresholdForPercent(90)).toBe('warning')
    expect(thresholdForPercent(91)).toBe('critical')
    expect(thresholdForPercent(100)).toBe('critical')
  })

  it('clamps to 100% and reports critical when usage exceeds the window', () => {
    const view = computeContextGauge({ contextWindow: 100, inputTokensUsed: 250 })
    expect(view?.value).toBe(100)
    expect(view?.threshold).toBe('critical')
    expect(view?.context.input_tokens_remaining).toBe(0)
  })

  it('hides (returns null) when the context window is unknown or non-positive', () => {
    expect(computeContextGauge({ contextWindow: null, inputTokensUsed: 100 })).toBeNull()
    expect(computeContextGauge({ contextWindow: 0, inputTokensUsed: 100 })).toBeNull()
    expect(computeContextGauge({ contextWindow: undefined, inputTokensUsed: 100 })).toBeNull()
  })

  it('hides (returns null) when no usage has been observed', () => {
    expect(computeContextGauge({ contextWindow: 1000, inputTokensUsed: null })).toBeNull()
    expect(computeContextGauge({ contextWindow: 1000, inputTokensUsed: undefined })).toBeNull()
  })
})

describe('context-usage plugin manifest', () => {
  it('advertises the status capability with a matching descriptor', () => {
    expect(contextUsagePluginManifest.id).toBe(CONTEXT_USAGE_PLUGIN_ID)
    expect(contextUsagePlugin().id).toBe(CONTEXT_USAGE_PLUGIN_ID)
    expect(contextUsagePluginManifest.capabilities).toEqual(['status'])
    expect(contextUsagePluginManifest.toolDescriptors).toBeUndefined()
    expect(contextUsagePluginManifest.statusDescriptor?.id).toBe(CONTEXT_USAGE_PLUGIN_ID)
    expect(contextUsagePluginManifest.statusDescriptor?.gaugeType).toBe('context_usage')
  })

  it('contributes neither tools nor hooks (status-only plugin)', () => {
    const plugin = contextUsagePlugin()
    expect(plugin.createTools).toBeUndefined()
    expect(plugin.createHooks).toBeUndefined()
  })

  it('satisfies the PluginModule contract for dynamic discovery', () => {
    expect(isPluginModule(contextUsageModule)).toBe(true)
    expect(contextUsageModule.manifest.id).toBe(CONTEXT_USAGE_PLUGIN_ID)
    expect(contextUsageModule.createPlugin().id).toBe(CONTEXT_USAGE_PLUGIN_ID)
  })
})
