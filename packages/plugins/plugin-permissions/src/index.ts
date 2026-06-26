import {
  type AgentHookContribution,
  type AgentPlugin,
  type PluginHost,
  type PluginManifest,
  type PluginModule,
  type ToolExecutionContext,
  type ToolGateResult
} from '@tinytinkerer/contracts'

// Stable id used as the activation key. Must match the manifest id surfaced in
// the Settings Modal.
export const PERMISSIONS_PLUGIN_ID = 'permissions'

// UI metadata for the host. This plugin contributes a single tool.beforeExecute
// gate (no tools of its own), so it advertises only the 'hooks' capability and
// ships no tool descriptors.
export const permissionsPluginManifest: PluginManifest = {
  id: PERMISSIONS_PLUGIN_ID,
  label: 'Permissions (ask before tools run)',
  description:
    'Pause before every tool runs and ask you to allow or deny it. When on, the ' +
    'assistant cannot run any tool — web search, MCP tools, or other plugin tools — ' +
    'until you confirm it in a prompt. Denying lets the run continue without that ' +
    'tool. Needs a host that can prompt you (the browser app); off by default.'
}

// Builds the reason carried on a denial so the runtime's
// "Tool execution blocked: <reason>" message names the tool that was denied. A
// reason supplied by the host is appended for context when present.
const denyReason = (toolId: string, hostReason?: string): string => {
  const base = `Permission denied for tool "${toolId}"`
  const trimmed = hostReason?.trim()
  return trimmed && trimmed.length > 0 ? `${base}: ${trimmed}` : base
}

// The single gate this plugin contributes. It delegates the allow/deny decision
// to the host's permission service and maps the outcome to a ToolGateResult.
const createPermissionGate = (host: PluginHost): AgentHookContribution => ({
  event: 'tool.beforeExecute',
  // This gate blocks on a human clicking Allow/Deny, so the runtime gives it a
  // much larger budget than a machine hook and surfaces a clear, user-facing
  // reason ("Timed out waiting for your approval.") instead of the internal
  // "hook timed out" string if the prompt is never answered.
  awaitsHumanInput: true,
  handler: async (context: ToolExecutionContext): Promise<ToolGateResult> => {
    // Self-gating tools (issue #85): a tool whose own execution already prompts the
    // user — the choice-prompt tool — sets `Tool.awaitsHumanInput`, which the runtime
    // surfaces here as `context.awaitsHumanInput`. Asking allow/deny before a tool
    // that already asks the user would be a prompt-to-show-a-prompt, so exempt it.
    // Keying off the context flag (not a tool id) keeps this generic for any future
    // human-input tool; the runtime no longer skips the gate, so this is the single
    // place the exemption lives.
    if (context.awaitsHumanInput) {
      return { allow: true }
    }

    // A host with no permission service cannot prompt a human (e.g. a headless
    // host running tests). It has no way to ask, so it must not block: default
    // to allow rather than denying every tool.
    if (!host.requestPermission) {
      return { allow: true }
    }

    const decision = await host.requestPermission({
      toolId: context.toolId,
      input: context.input,
      stepId: context.stepId,
      ...(context.parentStepId ? { parentStepId: context.parentStepId } : {})
    })

    if (decision.allow) {
      return { allow: true }
    }

    return {
      allow: false,
      reason: denyReason(context.toolId, decision.reason)
    }
  }
})

// The permissions plugin. Contributes one tool.beforeExecute gate and no tools;
// needs no activate/deactivate lifecycle. The host (app-browser) supplies the
// permission service that opens the confirmation modal.
export const permissionsPlugin = (): AgentPlugin => ({
  id: PERMISSIONS_PLUGIN_ID,
  createHooks: (host): AgentHookContribution[] => [createPermissionGate(host)]
})

// PluginModule contract surface: the named exports a host discovers dynamically.
export const manifest: PluginManifest = permissionsPluginManifest
export const createPlugin: PluginModule['createPlugin'] = permissionsPlugin
