import {
  isPluginModule,
  type AgentHookContribution,
  type HumanPromptResult,
  type PluginHost,
  type ToolExecutionContext
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

// A host whose single human-input prompt resolves with the given answer.
const promptFor = (result: HumanPromptResult) =>
  vi.fn<NonNullable<PluginHost['requestHumanInput']>>().mockResolvedValue(result)

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

  it('builds the allow/deny prompt view and allows when the user picks Allow', async () => {
    const requestHumanInput = promptFor({ kind: 'action', id: 'allow' })
    const host: PluginHost = { capture: vi.fn(), requestHumanInput }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext({ parentStepId: 'act-1' }))

    expect(result).toEqual({ allow: true })
    // The plugin owns the view: an alertdialog with Allow/Deny actions and the gated
    // tool's input handed to the host for cross-plugin body enrichment by tool id.
    expect(requestHumanInput).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'alertdialog',
        ariaLabel: 'Tool permission request',
        inputContext: { toolId: 'web-search', input: { query: 'cats' } },
        actions: [
          { id: 'deny', label: 'Deny' },
          { id: 'allow', label: 'Allow', tone: 'primary' }
        ]
      })
    )
  })

  it('denies and names the tool when the user picks Deny', async () => {
    const host: PluginHost = {
      capture: vi.fn(),
      requestHumanInput: promptFor({ kind: 'action', id: 'deny' })
    }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext())

    expect(result).toEqual({ allow: false, reason: 'Permission denied for tool "web-search"' })
  })

  it('treats a dismissal (overlay/Escape) as a deny that names the tool', async () => {
    const host: PluginHost = {
      capture: vi.fn(),
      requestHumanInput: promptFor({ kind: 'dismissed' })
    }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext({ toolId: 'mcp:files:read' }))

    expect(result).toEqual({ allow: false, reason: 'Permission denied for tool "mcp:files:read"' })
  })

  it('defaults to allow when the host cannot prompt a human', async () => {
    const host: PluginHost = { capture: vi.fn() }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext())

    expect(result).toEqual({ allow: true })
  })

  it('self-exempts a human-input tool: allows without prompting (issue #85)', async () => {
    // A tool that already prompts the user (context.awaitsHumanInput) must not be put
    // behind an allow/deny prompt — that would be a prompt-to-show-a-prompt. The gate
    // returns allow immediately and never opens the human-input prompt.
    const requestHumanInput = promptFor({ kind: 'dismissed' })
    const host: PluginHost = { capture: vi.fn(), requestHumanInput }
    const gate = gateOf(host)

    const result = await gate.handler(toolContext({ toolId: 'ask_user', awaitsHumanInput: true }))

    expect(result).toEqual({ allow: true })
    expect(requestHumanInput).not.toHaveBeenCalled()
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
