import {
  isPluginModule,
  type AgentHookContribution,
  type PermissionRequest,
  type PluginHost,
  type ToolExecutionContext,
  type ToolGateResult
} from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as permissionsModule from '../src/index'
import { PERMISSIONS_PLUGIN_ID, permissionsPlugin, permissionsPluginManifest } from '../src/index'

const toolContext = (overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  stepId: 'step-1',
  toolId: 'web-search',
  input: { query: 'cats' },
  ...overrides
})

type ToolGate = Extract<AgentHookContribution, { event: 'tool.beforeExecute' }>

const gateOf = (host: PluginHost): ToolGate => {
  const [hook] = permissionsPlugin().createHooks?.(host) ?? []
  if (!hook || hook.event !== 'tool.beforeExecute') {
    throw new Error('expected a tool.beforeExecute gate')
  }
  return hook
}

describe('permissionsPlugin', () => {
  it('contributes a single tool.beforeExecute gate and no tools', () => {
    const host: PluginHost = { capture: vi.fn() }
    const plugin = permissionsPlugin()
    const hooks = plugin.createHooks?.(host) ?? []
    expect(hooks.map((h) => h.event)).toEqual(['tool.beforeExecute'])
    expect(plugin.createTools).toBeUndefined()
  })

  it('delegates to the host permission service and allows when granted', async () => {
    const requestPermission = vi
      .fn<(request: PermissionRequest) => Promise<ToolGateResult>>()
      .mockResolvedValue({ allow: true })
    const host: PluginHost = { capture: vi.fn(), requestPermission }
    const gate = gateOf(host)

    const context = toolContext({ parentStepId: 'act-1' })
    const result = await gate.handler(context)

    expect(result).toEqual({ allow: true })
    expect(requestPermission).toHaveBeenCalledWith({
      toolId: 'web-search',
      input: { query: 'cats' },
      stepId: 'step-1',
      parentStepId: 'act-1'
    })
  })

  it('maps a denial to a deny result whose reason names the tool', async () => {
    const requestPermission = vi
      .fn<(request: PermissionRequest) => Promise<ToolGateResult>>()
      .mockResolvedValue({ allow: false, reason: 'User declined' })
    const host: PluginHost = { capture: vi.fn(), requestPermission }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext())

    expect(result).toEqual({
      allow: false,
      reason: 'Permission denied for tool "web-search": User declined'
    })
  })

  it('still names the tool when the host gives no reason', async () => {
    const requestPermission = vi
      .fn<(request: PermissionRequest) => Promise<ToolGateResult>>()
      .mockResolvedValue({ allow: false, reason: '   ' })
    const host: PluginHost = { capture: vi.fn(), requestPermission }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext({ toolId: 'mcp:files:read' }))

    expect(result).toEqual({
      allow: false,
      reason: 'Permission denied for tool "mcp:files:read"'
    })
  })

  it('defaults to allow when the host has no permission service', async () => {
    const host: PluginHost = { capture: vi.fn() }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext())

    expect(result).toEqual({ allow: true })
  })

  it('self-exempts a human-input tool: allows without consulting the host (issue #85)', async () => {
    // A tool that already prompts the user (context.awaitsHumanInput) must not be put
    // behind an allow/deny prompt — that would be a prompt-to-show-a-prompt. The gate
    // returns allow immediately and never calls the host permission service.
    const requestPermission = vi
      .fn<(request: PermissionRequest) => Promise<ToolGateResult>>()
      .mockResolvedValue({ allow: false, reason: 'should never be asked' })
    const host: PluginHost = { capture: vi.fn(), requestPermission }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext({ toolId: 'ask_user', awaitsHumanInput: true }))

    expect(result).toEqual({ allow: true })
    expect(requestPermission).not.toHaveBeenCalled()
  })

  it('manifest id matches the plugin id and contributes no tools', () => {
    expect(permissionsPluginManifest.id).toBe(PERMISSIONS_PLUGIN_ID)
    expect(permissionsPlugin().id).toBe(PERMISSIONS_PLUGIN_ID)
    expect(permissionsPluginManifest.toolDescriptors).toBeUndefined()
  })

  it('satisfies the PluginModule contract for dynamic discovery', () => {
    expect(isPluginModule(permissionsModule)).toBe(true)
    expect(permissionsModule.manifest.id).toBe(PERMISSIONS_PLUGIN_ID)
    expect(permissionsModule.createPlugin().id).toBe(PERMISSIONS_PLUGIN_ID)
  })
})
