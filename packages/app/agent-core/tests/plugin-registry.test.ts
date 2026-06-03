import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { PluginRegistry } from '../src/plugins/registry'
import { PluginCaptureError, type AgentPlugin, type PluginHost } from '../src/plugins/types'
import type { Tool } from '../src/tools/registry'

const echoTool = (id: string, execute: Tool<unknown, unknown>['execute']): Tool<unknown, unknown> => ({
  id,
  description: 'test',
  schema: z.object({}).passthrough(),
  execute
})

const plugin = (
  id: string,
  tools: Tool<unknown, unknown>[],
  overrides: Partial<AgentPlugin> = {}
): AgentPlugin => ({
  id,
  createTools: () => tools,
  ...overrides
})

describe('PluginRegistry', () => {
  it('collects tools only for active plugins', () => {
    const host: PluginHost = { capture: vi.fn() }
    const registry = new PluginRegistry()
    registry.register(plugin('a', [echoTool('a:tool', async () => 'a')]))
    registry.register(plugin('b', [echoTool('b:tool', async () => 'b')]))

    const tools = registry.collectTools(new Set(['a']), host)

    expect(tools.map((t) => t.id)).toEqual(['a:tool'])
  })

  it('lists every registered plugin', () => {
    const registry = new PluginRegistry()
    registry.register(plugin('a', []))
    registry.register(plugin('b', []))
    expect(registry.list().map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('routes a thrown PluginCaptureError to the host sink and rethrows', async () => {
    const capture = vi.fn()
    const host: PluginHost = { capture }
    const report = { pluginId: 'a', kind: 'feedback', message: 'hello' }
    const registry = new PluginRegistry()
    registry.register(
      plugin('a', [
        echoTool('a:tool', async () => {
          throw new PluginCaptureError(report, 'not implemented')
        })
      ])
    )

    const [tool] = registry.collectTools(new Set(['a']), host)

    await expect(tool!.execute({})).rejects.toThrow('not implemented')
    expect(capture).toHaveBeenCalledWith(report)
  })

  it('does not call the sink for other errors', async () => {
    const capture = vi.fn()
    const host: PluginHost = { capture }
    const registry = new PluginRegistry()
    registry.register(
      plugin('a', [
        echoTool('a:tool', async () => {
          throw new Error('boom')
        })
      ])
    )

    const [tool] = registry.collectTools(new Set(['a']), host)

    await expect(tool!.execute({})).rejects.toThrow('boom')
    expect(capture).not.toHaveBeenCalled()
  })

  it('activates a newly-active plugin once', () => {
    const host: PluginHost = { capture: vi.fn() }
    const activate = vi.fn()
    const registry = new PluginRegistry()
    registry.register(plugin('a', [], { activate }))

    registry.collectTools(new Set(['a']), host)
    registry.collectTools(new Set(['a']), host)

    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('deactivates a plugin that becomes inactive between calls', () => {
    const host: PluginHost = { capture: vi.fn() }
    const deactivate = vi.fn()
    const registry = new PluginRegistry()
    registry.register(plugin('a', [], { deactivate }))

    registry.collectTools(new Set(['a']), host)
    expect(deactivate).not.toHaveBeenCalled()

    registry.collectTools(new Set(), host)
    expect(deactivate).toHaveBeenCalledTimes(1)

    // Re-activation works after a deactivate.
    const activate = vi.fn()
    registry.register(plugin('a', [], { activate, deactivate }))
    registry.collectTools(new Set(['a']), host)
    expect(activate).toHaveBeenCalledTimes(1)
  })

  it('does not let a throwing createTools break runtime construction', () => {
    const host: PluginHost = { capture: vi.fn() }
    const registry = new PluginRegistry()
    registry.register({
      id: 'bad',
      createTools: () => {
        throw new Error('construction failed')
      }
    })
    registry.register(plugin('good', [echoTool('good:tool', async () => 'ok')]))

    const tools = registry.collectTools(new Set(['bad', 'good']), host)

    expect(tools.map((t) => t.id)).toEqual(['good:tool'])
  })

  it('rethrows the original tool error even when the capture sink throws', async () => {
    const host: PluginHost = {
      capture: () => {
        throw new Error('sink exploded')
      }
    }
    const report = { pluginId: 'a', kind: 'feedback', message: 'hello' }
    const registry = new PluginRegistry()
    registry.register(
      plugin('a', [
        echoTool('a:tool', async () => {
          throw new PluginCaptureError(report, 'not implemented')
        })
      ])
    )

    const [tool] = registry.collectTools(new Set(['a']), host)

    await expect(tool!.execute({})).rejects.toThrow('not implemented')
  })
})
