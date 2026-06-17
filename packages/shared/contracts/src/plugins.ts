import { z, type ZodSchema } from 'zod'
import type { ChatEvent } from './index'

// Plugin contracts — schemas, inferred types, and the plugin SDK (the plugin
// contract) shared by the agent-core plugin runtime, the plugin packages,
// app-core settings orchestration, and the app-browser Settings Modal. These are
// NOT edge DTOs (plugins have no backend route today), so they live in their own
// module rather than ./edge.
//
// The plugin SDK lives here — in contracts, the leaf package — so a plugin
// package can depend ONLY on contracts. agent-core re-exports everything below
// (the plugin contract + the Tool interface) so its public surface is unchanged;
// it owns the *runtime* (PluginRegistry, hooks, ToolRegistry), contracts owns the
// *contract*. contracts must stay a leaf: nothing here may import from agent-core.

// The two kinds of feedback the tool accepts: a defect report, or a suggested
// improvement/feature idea. There is no neutral catch-all — the sender (user or
// agent) must classify the feedback so the maintainers can triage it.
export const feedbackCategorySchema = z.enum(['bug', 'idea'])
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>

// Input contract for the `send_feedback` tool exposed by the feedback plugin.
// `message` is sender-authored content; routing it to telemetry is an intentional
// privacy exception gated behind both plugin activation and telemetry consent.
// `category` is required so every report is classified as a bug or an idea.
export const feedbackInputSchema = z.object({
  message: z.string().min(1).max(2000),
  category: feedbackCategorySchema
})
export type FeedbackInput = z.infer<typeof feedbackInputSchema>

// Persisted activation state for optional plugins: a map of pluginId -> enabled.
// A missing entry means "not activated"; all plugins are off by default.
export const pluginActivationStateSchema = z.record(z.string(), z.boolean())
export type PluginActivationState = z.infer<typeof pluginActivationStateSchema>

// =============================================================================
// Tool interface — the pure tool contract.
// =============================================================================
//
// The minimal, runtime-agnostic shape of a tool: an id, a planner-facing
// description, a Zod input schema, and an async execute. It lives here (not in
// agent-core) because the plugin contract below references it and contracts is
// the leaf — a plugin package builds tools against this interface depending only
// on contracts. The runtime ToolRegistry (validation + dispatch) stays in
// agent-core and imports this type from here.
export interface Tool<Input, Output> {
  id: string
  description: string
  schema: ZodSchema<Input>
  execute(input: Input): Promise<Output>
}

// =============================================================================
// Plugin SDK — the plugin contract.
// =============================================================================

// A structured report a plugin asks the host to capture out-of-band (e.g. to
// Sentry telemetry in the browser). The shape is SDK-agnostic and intentionally
// mirrors the telemetry capture options without importing any telemetry package,
// keeping contracts a leaf.
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
export type PermissionRequestService = (request: PermissionRequest) => Promise<ToolGateResult>

// The minimal, product-agnostic view of an edge response a plugin tool reads.
// The host owns the underlying request (and its request telemetry); `json()`
// reads the body and the host applies any intrinsic response-parse telemetry.
// Kept structurally tiny so a plugin never touches a real `Response` or any
// browser API — contracts stays a leaf.
export type PluginEdgeResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

// An injected capability that performs an edge POST on the host's behalf and
// returns the minimal PluginEdgeResponse above. The host implements it from its
// own edge/fetch layer (so request telemetry is preserved); only hosts that have
// an edge backend provide it, so a plugin tool that needs it must tolerate its
// absence (contribute no tool when it is missing). Mirrors how `capture` and
// `requestPermission` are injected — the contract only owns the function type.
export type PluginEdgeFetch = (
  path: string,
  body: unknown,
  options?: { area?: string }
) => Promise<PluginEdgeResponse>

// A request to run arbitrary code in an isolated sandbox. Product-agnostic: the
// plugin only describes *what* to run (the source and an optional structured
// input), never *how*. The host owns the isolation boundary entirely. `timeoutMs`
// is a hint the host clamps to its own ceiling — a plugin may ask for a smaller
// budget but cannot exceed the host's limit.
export type SandboxExecutionRequest = {
  code: string
  // Optional structured input passed into the sandbox. Any JSON-shaped value is
  // allowed — an object or a top-level array — so the host clones it to the
  // sandbox unchanged.
  input?: Record<string, unknown> | unknown[]
  timeoutMs?: number
}

// The outcome of a sandboxed run. A run that the host successfully isolated and
// completed reports `ok: true` with the script's `result` and any captured
// console output in `logs`. A run that threw, hit a host limit, or timed out
// reports `ok: false` with `error`/`timedOut` set — this is a *normal* outcome,
// not a host failure, so the plugin returns it to the agent rather than throwing.
export type SandboxExecutionResult = {
  ok: boolean
  result?: unknown
  logs: string[]
  timedOut: boolean
  error?: string
}

// An injected capability that runs code in an isolated browser sandbox (an
// ephemeral, opaque-origin iframe + Worker with an in-document CSP and a strict
// postMessage boundary) on the host's behalf. Only hosts that can actually
// provide that isolation register it; a plugin tool that needs it must tolerate
// its absence (contribute no tool when missing). Mirrors how `edgeFetch` is
// injected — the contract only owns the function type, never the implementation.
export type SandboxCodeExecutor = (
  request: SandboxExecutionRequest
) => Promise<SandboxExecutionResult>

// A narrow query against the host page's live DOM. Product-agnostic: the plugin
// only describes WHAT to read; the host owns DOM access, capping, and redaction.
// `include` selects which per-node fields to serialize; `maxNodes`/`maxChars` are
// hints the host clamps to its own ceilings (a caller may ask for less but never
// more). The query resolves to one of three modes:
//   - `region: 'top' | 'bottom'` → visible elements ordered by vertical position
//     on the page (bottom = furthest down first), so "what's at the bottom" works
//     without guessing a selector. Combine with `selector` to restrict candidates.
//   - no `selector` (and no `region`) → page meta plus a depth-limited STRUCTURAL
//     OUTLINE of the page tree (tag/id/classes/childCount + a short text preview),
//     so a caller can see the real subtree (e.g. under a SPA's `#root`) in one
//     call and then drill in. `depth` sets how many levels deep the outline goes.
//   - `selector` → the matched elements; `depth` (default 0 = flat) additionally
//     nests each match's descendants as `children`.
export type DomQuery = {
  selector?: string
  include?: Array<'html' | 'text' | 'attributes' | 'rect'>
  // Descendant levels to nest under each returned node (and the outline depth when
  // no selector is given). 0 = flat. The host clamps it to its own ceiling.
  depth?: number
  // Position-aware mode: order rendered elements by where they sit on the page.
  region?: 'top' | 'bottom'
  maxNodes?: number
  maxChars?: number
}

// One matched element, serialized to plain data. `html`/`text` are capped to the
// query's `maxChars` (host ceiling applies); `rect` reports layout box + a
// visibility heuristic. `childCount` is the element's element-child count (so a
// caller knows a subtree exists even when `children` is omitted or capped);
// `children` carries nested descendants when `depth`/outline mode requests them.
// The host redacts form-field values before returning, so nothing the user typed
// but has not sent leaks through `html`/`attributes`.
export type DomNodeResult = {
  tag: string
  id?: string
  classes?: string[]
  html?: string
  text?: string
  attributes?: Record<string, string>
  rect?: { x: number; y: number; width: number; height: number; visible: boolean }
  childCount?: number
  children?: DomNodeResult[]
  truncated?: boolean
}

// The outcome of a DOM read. `matchedCount` is the total elements the selector
// matched (may exceed `nodes.length` when capped); `truncated` is set when the
// host dropped matches or shortened any node payload to stay within budget.
export type DomReadResult = {
  url: string
  title: string
  viewport: { width: number; height: number }
  matchedCount: number
  nodes: DomNodeResult[]
  truncated: boolean
}

// An injected capability that reads the host page's live DOM via a narrow query
// on the plugin's behalf. Only hosts with a DOM (the browser) register it; a tool
// that needs it must tolerate its absence (contribute no tool when missing).
// Mirrors how `executeSandboxedCode` is injected — the contract owns only the
// function type, never the implementation, and the host enforces all caps and
// redaction so the plugin stays product-agnostic.
export type DomReader = (query: DomQuery) => Promise<DomReadResult>

// Host services handed to plugins at activation / tool-construction time. Kept
// minimal and product-agnostic so plugin packages never reach into a specific
// runtime or browser API.
export interface PluginHost {
  capture: PluginCaptureSink
  // Optional: present only on hosts that can prompt a human. See
  // PermissionRequestService — plugins must tolerate its absence.
  requestPermission?: PermissionRequestService
  // Optional: present only on hosts with an edge backend. A tool that needs to
  // reach the edge (e.g. web search) builds against this and must tolerate its
  // absence. See PluginEdgeFetch.
  edgeFetch?: PluginEdgeFetch
  // Optional: present only on hosts that can run an isolated browser sandbox
  // (iframe + Worker, opaque origin, CSP). A tool that needs it (e.g. code
  // execution) builds against this and must tolerate its absence (contribute no
  // tool when missing). See SandboxCodeExecutor.
  executeSandboxedCode?: SandboxCodeExecutor
  // Optional: present only on hosts with a live DOM (the browser). A tool that
  // reads the current page (e.g. the browser-state plugin) builds against this
  // and must tolerate its absence (contribute no tool when missing). See
  // DomReader.
  readDom?: DomReader
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

export type ToolGateResult = { allow: true } | { allow: false; reason: string }

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
      handler: (context: ToolExecutionContext) => ToolGateResult | Promise<ToolGateResult>
      // Set by gates that block on a human decision (e.g. an allow/deny prompt).
      // The runtime gives these a separate, much larger timeout than a machine
      // hook and surfaces a clear, user-facing reason if that budget elapses —
      // see runToolBeforeExecuteHooks and AgentRuntimeOptions.humanHookTimeoutMs.
      awaitsHumanInput?: boolean
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

// A product-agnostic, React-free view-model a tool's owner produces from its raw
// output so the host can render a consistent activity summary without knowing any
// specific tool's shape. `title` (plus optional status styling) shows in the
// collapsed summary; `sections` render as label/value rows when expanded. The
// host renders every value as plain text — never HTML — because tool output is
// untrusted. Lives in the contract layer so plugins ship data, never a component.
export type ActivityView = {
  title: string
  status?: 'ok' | 'error' | 'warn'
  sections: { label: string; value: string }[]
}

// A pure function a tool's owner exposes to map its raw output to an ActivityView.
// Must stay product-agnostic: no React/DOM/window — it only transforms data
// (enforced by scripts/check-boundaries.mjs for plugin packages). The host
// resolves one per tool id and feeds the result into its single generic activity
// renderer; tools without one fall back to the host's neutral default.
export type ActivitySummarizer = (output: unknown) => ActivityView

// Planner-facing description of a tool a plugin contributes. Lets a host name the
// tool to its planner/model without instantiating the plugin. Structurally
// matches the host's own planner descriptor shape (id / description / schema).
export type PluginToolDescriptor = {
  id: string
  description: string
  inputSchema: Record<string, unknown>
  // Optional pure mapper from this tool's raw output to an ActivityView the host
  // renders in the turn-activity panel. Keyed by tool id (this descriptor's `id`),
  // so the tool's owner — not the host — decides how its activity is summarized.
  // Product-agnostic (no React/DOM). Omit it and the host uses a neutral default.
  summarizeActivity?: ActivitySummarizer
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
  // Default activation when the user has no stored preference. Plugins are
  // off by default (`undefined`/`false`); a plugin that should ship enabled
  // out-of-the-box (e.g. web search) sets this to `true`. An explicit user
  // choice in settings always wins over this default.
  defaultEnabled?: boolean
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
    typeof m.id === 'string' && typeof m.label === 'string' && typeof m.description === 'string'
  )
}
