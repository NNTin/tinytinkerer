import type { ChatEvent } from '@tinytinkerer/contracts'
import type { Tool } from '../tools/registry'

// A structured report a plugin asks the host to capture out-of-band (e.g. to
// Sentry telemetry in the browser). The shape is SDK-agnostic and intentionally
// mirrors the telemetry capture options without importing any telemetry package,
// keeping agent-core a leaf that depends only on contracts.
export type PluginReport = {
  pluginId: string
  kind: string
  message: string
  // `info` is captured as an informational telemetry *message* (not an error
  // issue); `warning`/`error` are captured as exceptions. See the host capture
  // sink in app-browser's create-runtime.
  level?: 'info' | 'warning' | 'error'
  contexts?: Record<string, Record<string, unknown>>
}

// The capture sink injected by the host. The browser wires this to the shared
// telemetry `captureTelemetryException`; other hosts may register a no-op. Like
// the telemetry sink, a host that registers nothing simply drops reports.
export type PluginCaptureSink = (report: PluginReport) => void

// A request for human-in-the-loop permission before a tool runs. Mirrors the
// runtime's ToolExecutionContext so a gating plugin can forward the tool it is
// about to guard (id, input, and the step linkage) verbatim to the host.
export type PermissionRequest = {
  toolId: string
  input: Record<string, unknown>
  stepId: string
  parentStepId?: string
}

// Optional service a host registers so a gating plugin can ask a human to allow
// or deny a tool before it runs. Resolves to a ToolGateResult. Only hosts that
// can actually prompt (e.g. the browser, via a modal) provide this; a headless
// host omits it and a gating plugin must default to allow when it is absent
// (it has no way to ask, so it cannot block).
export type PermissionRequestService = (
  request: PermissionRequest
) => Promise<ToolGateResult>

// Host services handed to plugins at activation / tool-construction time. Kept
// minimal and product-agnostic so plugin packages never reach into a specific
// runtime or browser API.
export interface PluginHost {
  capture: PluginCaptureSink
  // Optional: present only on hosts that can prompt a human. See
  // PermissionRequestService — plugins must tolerate its absence.
  requestPermission?: PermissionRequestService
}

export type ChatEventHookContext = {
  event: ChatEvent
}

export type ToolExecutionContext = {
  stepId: string
  parentStepId?: string
  toolId: string
  input: Record<string, unknown>
}

export type ToolGateResult =
  | { allow: true }
  | { allow: false; reason: string }

// Hook contributions are intentionally split into observer hooks and explicit
// gates. Observers can react to runtime events but cannot change execution;
// gates are awaited by the runtime and may block the operation they guard.
export type AgentHookContribution =
  | {
      event: 'chat.event'
      handler: (context: ChatEventHookContext) => void | Promise<void>
    }
  | {
      event: 'tool.beforeExecute'
      handler: (
        context: ToolExecutionContext
      ) => ToolGateResult | Promise<ToolGateResult>
    }

// Typed error a plugin tool may throw to (a) report a structured payload to the
// host capture sink and (b) still surface a failure to the agent runtime. The
// registry recognises this type, routes `report` to `host.capture`, and rethrows
// so the runtime's normal tool-failure path (agent.tool.failed) still runs.
export class PluginCaptureError extends Error {
  readonly report: PluginReport

  constructor(report: PluginReport, message?: string) {
    super(message ?? report.message)
    this.name = 'PluginCaptureError'
    this.report = report
  }
}

// The plugin contract. A plugin optionally contributes tools and may run setup /
// teardown when its activation state flips. Tools are constructed against the
// host so they can route structured reports through the capture sink.
export interface AgentPlugin {
  id: string
  createTools?(host: PluginHost): Tool<unknown, unknown>[]
  createHooks?(host: PluginHost): AgentHookContribution[]
  activate?(host: PluginHost): void | Promise<void>
  deactivate?(): void | Promise<void>
}

// Planner-facing description of a tool a plugin contributes. Lets a host name the
// tool to its planner/model without instantiating the plugin. Structurally
// matches the host's own planner descriptor shape (id / description / schema).
export type PluginToolDescriptor = {
  id: string
  description: string
  inputSchema: Record<string, unknown>
}

// Host-agnostic metadata about a plugin: the copy a host surfaces in its settings
// UI plus the planner descriptors for the tools the plugin contributes. Lives in
// the contract layer (not inside any concrete plugin) so hosts depend only on the
// abstraction. A plugin ships its own manifest.
export type PluginManifest = {
  id: string
  label: string
  description: string
  capabilities?: Array<'tools' | 'hooks'>
  toolDescriptors?: PluginToolDescriptor[]
}

// The shape every plugin package's entry module must export for dynamic
// discovery. A host loads candidate plugin modules with `import()` and validates
// them with `isPluginModule`, tolerating a missing or malformed module so an
// optional plugin can simply be absent. The host never statically imports a
// concrete plugin; it only depends on this contract.
export type PluginModule = {
  manifest: PluginManifest
  createPlugin: () => AgentPlugin
}

// Runtime guard so a host can validate a dynamically-imported module before
// trusting it as a plugin. Keeps plugin loading best-effort: anything that does
// not match the contract (absent package, wrong export shape) is rejected here
// instead of throwing into runtime construction.
export const isPluginModule = (value: unknown): value is PluginModule => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { manifest?: unknown; createPlugin?: unknown }
  if (typeof candidate.createPlugin !== 'function') {
    return false
  }
  const manifest = candidate.manifest
  if (typeof manifest !== 'object' || manifest === null) {
    return false
  }
  const m = manifest as { id?: unknown; label?: unknown; description?: unknown }
  return (
    typeof m.id === 'string' &&
    typeof m.label === 'string' &&
    typeof m.description === 'string'
  )
}
