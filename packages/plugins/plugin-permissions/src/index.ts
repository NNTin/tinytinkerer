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
// "Tool execution blocked: <reason>" message names the tool that was denied.
const denyReason = (toolId: string): string => `Permission denied for tool "${toolId}"`

// The single gate this plugin contributes. It builds the host's generic human-prompt
// VIEW (an alertdialog with Allow/Deny + the gated tool's input body) and maps the
// user's answer to a ToolGateResult. The host owns the modal; this plugin owns the
// prompt definition and the decision — it ships data, never a component.
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

    // A host that cannot prompt a human (e.g. a headless host running tests) has no
    // way to ask, so it must not block: default to allow rather than denying every tool.
    if (!host.requestHumanInput) {
      return { allow: true }
    }

    const answer = await host.requestHumanInput({
      role: 'alertdialog',
      ariaLabel: 'Tool permission request',
      title: 'Allow this tool to run?',
      description: 'The assistant wants to run a tool. Review it and choose whether to allow it.',
      // The host renders the tool's input via the gated tool owner's summarizePermission
      // (resolved by tool id), so the rich per-tool body stays with that tool, not here.
      inputContext: { toolId: context.toolId, input: context.input },
      actions: [
        { id: 'deny', label: 'Deny' },
        { id: 'allow', label: 'Allow', tone: 'primary' }
      ],
      // Overlay / Escape is the safe deny for a permission prompt; no explicit Skip
      // button — Deny already is the visible "decline" affordance.
      dismissLabel: 'Deny tool'
    })

    // Only an explicit Allow lets the tool run; Deny, a dismissal (overlay/Escape), or
    // any other answer blocks it. The reason names the tool for the runtime's
    // "Tool execution blocked: <reason>" message.
    if (answer.kind === 'action' && answer.id === 'allow') {
      return { allow: true }
    }

    return { allow: false, reason: denyReason(context.toolId) }
  }
})

// The permissions plugin. Contributes one tool.beforeExecute gate and no tools;
// needs no activate/deactivate lifecycle. The host (app-browser) supplies the
// requestHumanInput capability that opens the generic confirmation modal.
export const permissionsPlugin = (): AgentPlugin => ({
  id: PERMISSIONS_PLUGIN_ID,
  createHooks: (host): AgentHookContribution[] => [createPermissionGate(host)]
})

// PluginModule contract surface: the named exports a host discovers dynamically.
export const manifest: PluginManifest = permissionsPluginManifest
export const createPlugin: PluginModule['createPlugin'] = permissionsPlugin
