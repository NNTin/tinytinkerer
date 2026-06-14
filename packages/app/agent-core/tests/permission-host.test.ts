import { describe, expect, it, vi } from 'vitest'
import { runToolBeforeExecuteHooks } from '../src/plugins/hooks'
import type {
  AgentHookContribution,
  PermissionRequest,
  PluginHost,
  ToolExecutionContext,
  ToolGateResult
} from '../src/plugins/types'

const context: ToolExecutionContext = {
  stepId: 'step-1',
  parentStepId: 'act-1',
  toolId: 'web-search',
  input: { query: 'cats' }
}

// A gate that mirrors a permission-gating plugin: it forwards the tool to the
// host's optional permission service. This exercises the PluginHost.requestPermission
// type addition end to end through runToolBeforeExecuteHooks.
const permissionGate = (host: PluginHost): AgentHookContribution => ({
  event: 'tool.beforeExecute',
  handler: async (ctx) =>
    host.requestPermission
      ? host.requestPermission({
          toolId: ctx.toolId,
          input: ctx.input,
          stepId: ctx.stepId,
          ...(ctx.parentStepId ? { parentStepId: ctx.parentStepId } : {})
        })
      : { allow: true }
})

describe('PluginHost.requestPermission', () => {
  it('lets a gate allow a tool via the host permission service', async () => {
    const requestPermission = vi
      .fn<(request: PermissionRequest) => Promise<ToolGateResult>>()
      .mockResolvedValue({ allow: true })
    const host: PluginHost = { capture: vi.fn(), requestPermission }

    const result = await runToolBeforeExecuteHooks(
      [permissionGate(host)],
      context,
      1000
    )

    expect(result).toEqual({ allow: true })
    expect(requestPermission).toHaveBeenCalledWith({
      toolId: 'web-search',
      input: { query: 'cats' },
      stepId: 'step-1',
      parentStepId: 'act-1'
    })
  })

  it('lets a gate deny a tool, carrying the reason to the runtime', async () => {
    const host: PluginHost = {
      capture: vi.fn(),
      requestPermission: () =>
        Promise.resolve({ allow: false, reason: 'Denied by user' })
    }

    const result = await runToolBeforeExecuteHooks(
      [permissionGate(host)],
      context,
      1000
    )

    expect(result).toEqual({ allow: false, reason: 'Denied by user' })
  })

  it('allows when the host omits the optional permission service', async () => {
    const host: PluginHost = { capture: vi.fn() }

    const result = await runToolBeforeExecuteHooks(
      [permissionGate(host)],
      context,
      1000
    )

    expect(result).toEqual({ allow: true })
  })
})
