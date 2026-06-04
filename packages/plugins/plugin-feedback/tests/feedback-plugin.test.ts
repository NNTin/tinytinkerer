import { isPluginModule, PluginRegistry, type PluginHost } from '@tinytinkerer/agent-core'
import { describe, expect, it, vi } from 'vitest'
import * as feedbackModule from '../src/index'
import {
  FeedbackPendingError,
  SEND_FEEDBACK_PLUGIN_ID,
  feedbackPlugin,
  feedbackPluginManifest
} from '../src/index'

describe('feedbackPlugin', () => {
  it('exposes a send_feedback tool', () => {
    const host: PluginHost = { capture: vi.fn() }
    const tools = feedbackPlugin().createTools?.(host) ?? []
    expect(tools.map((t) => t.id)).toEqual(['send_feedback'])
  })

  it('throws FeedbackPendingError carrying the feedback report', async () => {
    const host: PluginHost = { capture: vi.fn() }
    const [tool] = feedbackPlugin().createTools?.(host) ?? []

    const error = await tool!
      .execute({ message: 'Great app', category: 'praise' })
      .then(() => null)
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(FeedbackPendingError)
    expect((error as FeedbackPendingError).message).toContain('not implemented')
    expect((error as FeedbackPendingError).report).toMatchObject({
      pluginId: SEND_FEEDBACK_PLUGIN_ID,
      kind: 'feedback',
      level: 'warning',
      contexts: { feedback: { category: 'praise', message: 'Great app' } }
    })
  })

  it('routes feedback to the host capture sink via the registry, then rethrows', async () => {
    const capture = vi.fn()
    const host: PluginHost = { capture }
    const registry = new PluginRegistry()
    registry.register(feedbackPlugin())

    const [tool] = registry.collectTools(new Set([SEND_FEEDBACK_PLUGIN_ID]), host)

    await expect(tool!.execute({ message: 'A bug', category: 'bug' })).rejects.toThrow(
      'not implemented'
    )
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture.mock.calls[0]![0]).toMatchObject({
      pluginId: SEND_FEEDBACK_PLUGIN_ID,
      contexts: { feedback: { category: 'bug', message: 'A bug' } }
    })
  })

  it('defaults the category to general when omitted', async () => {
    const host: PluginHost = { capture: vi.fn() }
    const [tool] = feedbackPlugin().createTools?.(host) ?? []
    const error = await tool!.execute({ message: 'no category' }).catch((e: unknown) => e)
    expect((error as FeedbackPendingError).report.contexts).toEqual({
      feedback: { category: 'general', message: 'no category' }
    })
  })

  it('manifest id matches the plugin id', () => {
    expect(feedbackPluginManifest.id).toBe(SEND_FEEDBACK_PLUGIN_ID)
    expect(feedbackPlugin().id).toBe(SEND_FEEDBACK_PLUGIN_ID)
  })

  it('exposes planner tool descriptors on the manifest', () => {
    expect(feedbackPluginManifest.toolDescriptors?.map((d) => d.id)).toEqual([
      'send_feedback'
    ])
  })

  it('satisfies the PluginModule contract for dynamic discovery', () => {
    // The host loads this module dynamically and validates it with isPluginModule,
    // so the package must export a contract-shaped `manifest` + `createPlugin`.
    expect(isPluginModule(feedbackModule)).toBe(true)
    expect(feedbackModule.manifest.id).toBe(SEND_FEEDBACK_PLUGIN_ID)
    expect(feedbackModule.createPlugin().id).toBe(SEND_FEEDBACK_PLUGIN_ID)
  })
})
