import { describe, expect, it, vi } from 'vitest'
import { runToolBeforeExecuteHooks } from '../src/plugins/hooks'
import type {
  AgentHookContribution,
  HumanPromptResult,
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

// A gate that mirrors the permissions plugin: it builds the host's generic human-prompt
// VIEW and maps the user's answer to a ToolGateResult. This exercises the single
// PluginHost.requestHumanInput capability end to end through runToolBeforeExecuteHooks.
const permissionGate = (host: PluginHost): AgentHookContribution => ({
  event: 'tool.beforeExecute',
  handler: async (ctx) => {
    if (!host.requestHumanInput) {
      return { allow: true }
    }
    const answer = await host.requestHumanInput({
      role: 'alertdialog',
      ariaLabel: 'Tool permission request',
      title: 'Allow this tool to run?',
      inputContext: { toolId: ctx.toolId, input: ctx.input },
      actions: [
        { id: 'deny', label: 'Deny' },
        { id: 'allow', label: 'Allow', tone: 'primary' }
      ],
      dismissLabel: 'Deny tool'
    })
    return answer.kind === 'action' && answer.id === 'allow'
      ? { allow: true }
      : { allow: false, reason: 'Denied by user' }
  }
})

describe('PluginHost.requestHumanInput', () => {
  it('lets a gate allow a tool via the host human-input prompt', async () => {
    const requestHumanInput = vi
      .fn<NonNullable<PluginHost['requestHumanInput']>>()
      .mockResolvedValue({ kind: 'action', id: 'allow' })
    const host: PluginHost = { capture: vi.fn(), requestHumanInput }

    const result = await runToolBeforeExecuteHooks([permissionGate(host)], context, 1000)

    expect(result).toEqual({ allow: true })
    expect(requestHumanInput).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'alertdialog',
        inputContext: { toolId: 'web-search', input: { query: 'cats' } }
      })
    )
  })

  it('lets a gate deny a tool, carrying the reason to the runtime', async () => {
    const denied: HumanPromptResult = { kind: 'action', id: 'deny' }
    const host: PluginHost = {
      capture: vi.fn(),
      requestHumanInput: () => Promise.resolve(denied)
    }

    const result = await runToolBeforeExecuteHooks([permissionGate(host)], context, 1000)

    expect(result).toEqual({ allow: false, reason: 'Denied by user' })
  })

  it('allows when the host omits the optional human-input capability', async () => {
    const host: PluginHost = { capture: vi.fn() }

    const result = await runToolBeforeExecuteHooks([permissionGate(host)], context, 1000)

    expect(result).toEqual({ allow: true })
  })

  it('denies a human gate with a clear, user-facing reason when it times out', async () => {
    // A human gate whose prompt is never answered (e.g. no modal mounted) must
    // fail closed with an explanation the user understands — not the internal
    // "hook timed out" string. The human budget is the 4th argument.
    const neverAnswered: AgentHookContribution = {
      event: 'tool.beforeExecute',
      awaitsHumanInput: true,
      handler: () => new Promise<ToolGateResult>(() => {})
    }

    const result = await runToolBeforeExecuteHooks([neverAnswered], context, 60_000, 5)

    expect(result).toEqual({
      allow: false,
      reason: 'Timed out waiting for your approval.'
    })
  })

  it('applies the longer human budget to a human gate, not the machine timeout', async () => {
    // With a tiny machine timeout but a generous human budget, a human gate that
    // resolves shortly after the machine timeout still succeeds — proving the
    // gate is held to humanInputTimeoutMs, not the machine timeoutMs.
    const slowApproval: AgentHookContribution = {
      event: 'tool.beforeExecute',
      awaitsHumanInput: true,
      handler: () =>
        new Promise<ToolGateResult>((resolve) => setTimeout(() => resolve({ allow: true }), 20))
    }

    const result = await runToolBeforeExecuteHooks([slowApproval], context, 1, 1000)

    expect(result).toEqual({ allow: true })
  })
})
