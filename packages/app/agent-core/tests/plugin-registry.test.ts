import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { PluginRegistry } from '../src/plugins/registry'
import {
  isPluginModule,
  PluginCaptureError,
  type AgentHookContribution,
  type AgentPlugin,
  type PluginHost
} from '../src/plugins/types'
import { ToolRegistry, type Tool } from '../src/tools/registry'

const echoTool = (
  id: string,
  execute: Tool<unknown, unknown>['execute']
): Tool<unknown, unknown> => ({
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

  it('collects hooks only for active plugins', () => {
    const host: PluginHost = { capture: vi.fn() }
    const hook: AgentHookContribution = {
      event: 'chat.event',
      handler: vi.fn()
    }
    const registry = new PluginRegistry()
    registry.register(plugin('a', [], { createHooks: () => [hook] }))
    registry.register(plugin('b', [], { createHooks: () => [hook] }))

    const contributions = registry.collectContributions(new Set(['a']), host)

    expect(contributions.tools).toEqual([])
    expect(contributions.hooks).toEqual([hook])
  })

  it('does not let a throwing createHooks break contribution collection', () => {
    const host: PluginHost = { capture: vi.fn() }
    const hook: AgentHookContribution = {
      event: 'chat.event',
      handler: vi.fn()
    }
    const registry = new PluginRegistry()
    registry.register(
      plugin('bad', [], {
        createHooks: () => {
          throw new Error('hook construction failed')
        }
      })
    )
    registry.register(plugin('good', [], { createHooks: () => [hook] }))

    const contributions = registry.collectContributions(new Set(['bad', 'good']), host)

    expect(contributions.hooks).toEqual([hook])
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

describe('ToolRegistry', () => {
  it('rejects duplicate tool ids instead of replacing the existing tool', () => {
    const registry = new ToolRegistry()
    registry.register(echoTool('tool', async () => 'first'))

    expect(() => registry.register(echoTool('tool', async () => 'second'))).toThrow(
      'Tool already registered: tool'
    )
  })
})

describe('isPluginModule', () => {
  const validModule = {
    manifest: { id: 'a', label: 'A', description: 'desc' },
    createPlugin: () => ({ id: 'a' })
  }

  it('accepts a well-formed plugin module', () => {
    expect(isPluginModule(validModule)).toBe(true)
  })

  it('accepts a manifest carrying tool descriptors', () => {
    expect(
      isPluginModule({
        ...validModule,
        manifest: { ...validModule.manifest, toolDescriptors: [] }
      })
    ).toBe(true)
  })

  it.each([
    ['null', null],
    ['a non-object', 'nope'],
    ['a missing createPlugin', { manifest: validModule.manifest }],
    ['a non-function createPlugin', { manifest: validModule.manifest, createPlugin: 1 }],
    ['a missing manifest', { createPlugin: () => ({ id: 'a' }) }],
    [
      'a manifest missing string fields',
      { manifest: { id: 'a' }, createPlugin: () => ({ id: 'a' }) }
    ]
  ])('rejects %s', (_label, value) => {
    expect(isPluginModule(value)).toBe(false)
  })

  it('accepts a manifest carrying capability metadata', () => {
    expect(
      isPluginModule({
        ...validModule,
        manifest: { ...validModule.manifest, capabilities: ['hooks'] }
      })
    ).toBe(true)
  })
})
