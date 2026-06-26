import { z, type ZodSchema } from 'zod'
import type { ChatEvent } from './index'
// Host↔plugin presentation view-models live in their own module to keep this file
// focused; PluginManifest references the two descriptor types below. See
// ./plugin-views for why these boundary view-models live in contracts.
import type { PluginStatusDescriptor, PluginInspectorDescriptor } from './plugin-views'

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
// Planner-facing prose lives on the schema (issue #287): the send_feedback tool
// descriptor's JSON Schema is generated from here, so these descriptions reach the
// model and cannot drift from the runtime contract.
export const feedbackInputSchema = z.object({
  message: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      'The feedback (1–2000 chars). For an environment limitation, describe what you ' +
        'were trying to do and which tool/capability/permission was missing.'
    ),
  category: feedbackCategorySchema.describe(
    'Required. "bug" for something broken or behaving incorrectly; "idea" for an ' +
      'improvement or feature suggestion (including your own environment limitations).'
  )
})
export type FeedbackInput = z.infer<typeof feedbackInputSchema>

// Input contract for the `ask_user` tool exposed by the choice-prompt plugin
// (issue #85) — the first interactive human-in-the-loop tool. The agent invokes
// it to ask the USER a question with a set of selectable `options`, optionally
// allowing a free-text `custom` answer. The shape is intentionally self-describing
// so the host can render the live poll directly from this input — unlike the
// permission prompt, no plugin-emitted view-model is needed. Planner-facing prose
// lives on the schema (#287): the descriptor's JSON Schema is generated from here,
// so what the model reads cannot drift from the runtime contract.
export const choicePromptInputSchema = z.object({
  question: z
    .string()
    .min(1)
    .max(1000)
    .describe('The question to ask the user. Be specific so the choice is unambiguous.'),
  options: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(10)
    .describe('The selectable answers (1–10). Each is a short, distinct label the user can pick.'),
  allowCustom: z
    .boolean()
    .default(true)
    .describe(
      'When true (default), the user may type a free-text answer instead of picking an option.'
    )
})
export type ChoicePromptInput = z.infer<typeof choicePromptInputSchema>

// Output contract for the `ask_user` tool (issue #85). A discriminated union over
// the three terminal outcomes so the model can react precisely: the user picked an
// `option`, typed a `custom` answer, or `dismissed` the prompt without choosing. A
// dismissal is a NORMAL result (the user declined), not a tool failure — the model
// is told and continues. The host PRODUCES this value, so the runtime validates it
// strictly via the tool's `outputSchema`.
export const choicePromptResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('option'), value: z.string() }),
  z.object({ kind: z.literal('custom'), text: z.string().max(2000) }),
  z.object({ kind: z.literal('dismissed') })
])
export type ChoicePromptResult = z.infer<typeof choicePromptResultSchema>

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
  // Optional output contract (issue #287). When present, the runtime
  // (ToolRegistry.run) parses the tool's result through it before returning, so
  // `agent.tool.completed.payload.output` is a VALIDATED structured payload by the
  // time the inspector/timeline consume it — not an unchecked `unknown`. Omit it
  // and the output stays unvalidated (the prior behaviour), which a tool whose
  // output shape is intentionally open (e.g. a sandbox result) relies on.
  //
  // This is an ENFORCEMENT point, not a hint: declaring it makes the registry THROW
  // (a ZodError surfaced to the run-error path) when a result fails the schema, so a
  // tool's output mismatch becomes a hard failure where it previously returned. Only
  // add one for a tool whose output you intend to gate that strictly.
  outputSchema?: ZodSchema<Output>
  // Human-in-the-loop tools (issue #85). A tool whose `execute` BLOCKS on a human
  // — e.g. the choice-prompt tool awaiting the user's selection — sets this. It
  // drives ONE runtime behaviour: TIMEOUT — the tool's execution is governed by the
  // human-input budget (`humanInputTimeoutMs`, minutes) instead of the short machine
  // `toolTimeoutMs` (10s), which a person could never beat.
  //
  // It ALSO makes the tool self-gating, but that is the GATE's concern, not the
  // runtime's: the runtime propagates this flag onto `ToolExecutionContext.awaitsHumanInput`,
  // and a `tool.beforeExecute` gate reads it to exempt the tool (the permissions gate
  // skips its allow/deny prompt — gating a tool that already asks the user would be a
  // prompt-to-show-a-prompt). Because the exemption lives in the gate, a future
  // non-permission gate still runs for human-input tools.
  //
  // Omit it (the default) and a tool keeps the machine timeout and is gated
  // normally — the prior behaviour, unchanged for every existing tool.
  awaitsHumanInput?: boolean
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
// `requestHumanInput` are injected — the contract only owns the function type.
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
  // Optional: present only on hosts that can prompt a human (the browser). The ONE
  // human-in-the-loop capability (issue #85): a plugin that needs the user — the
  // permissions gate's allow/deny, the choice-prompt poll — builds a HumanPromptView
  // and awaits the answer here; the host renders its single generic modal and resolves
  // a HumanPromptResult the plugin maps back to its own outcome. A plugin must tolerate
  // its absence (a gate defaults to allow; a tool contributes nothing). Replaces the
  // former per-feature requestPermission / requestUserChoice. See HumanInputService.
  requestHumanInput?: HumanInputService
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
  // True when the tool being guarded is itself a human-in-the-loop tool (issue
  // #85) — the runtime sets this from the tool's `Tool.awaitsHumanInput`. A gate
  // reads it to SELF-EXEMPT a tool that already prompts the user: e.g. the
  // permissions gate skips its allow/deny prompt for the choice-prompt tool, since
  // gating a tool that already asks the user would be a prompt-to-show-a-prompt.
  // The exemption is the gate's own concern — the runtime no longer skips the gate
  // chain — so a future non-permission gate still runs for human-input tools.
  awaitsHumanInput?: boolean
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
      // see runToolBeforeExecuteHooks and AgentRuntimeOptions.humanInputTimeoutMs.
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

const boundedText = (text: string, max: number): string => {
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

// Renders an arbitrary value as a short, plain-text preview. Non-strings are
// JSON-serialized where possible and fall back to String(), then the final text is
// bounded so plugin-authored summaries cannot flood host surfaces.
export const boundedPreview = (value: unknown, max: number): string => {
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value) ?? String(value)
    } catch {
      text = String(value)
    }
  }
  return boundedText(text, max)
}

// Pretty-prints a JSON dump defensively and bounds its rendered size. Used by host
// fallback surfaces for untrusted tool values; the full value still travels through
// the runtime/model path.
export const boundedJson = (value: unknown, max: number): string => {
  let text: string
  try {
    text = JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return '(value could not be displayed)'
  }
  return boundedText(text, max)
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

// One section of an ActivityView. Mirrors PermissionViewSection so the host can
// drive both surfaces with the same generic renderer: a `text` section is a plain
// label/value row (the default, untrusted output rendered as text — never HTML); a
// `code` section is shown read-only with syntax highlighting in the named language;
// a `json` section is shown as a serialized dump. Lives in the contract layer so
// plugins ship data, never a component.
export type ActivityViewSection =
  | { kind: 'text'; label: string; value: string }
  | { kind: 'code'; label: string; language: string; code: string }
  | { kind: 'json'; label: string; value: unknown }

export type ActivityTextSection = Extract<ActivityViewSection, { kind: 'text' }>
export type ActivityCodeSection = Extract<ActivityViewSection, { kind: 'code' }>
export type ActivityJsonSection = Extract<ActivityViewSection, { kind: 'json' }>

export type ActivityStatus = 'ok' | 'error' | 'warn' | 'unknown'

// A product-agnostic, React-free view-model a tool's owner produces from its raw
// output so the host can render a consistent activity summary without knowing any
// specific tool's shape. `title` (plus optional status styling) shows in the
// collapsed summary; `sections` render when expanded. The host renders text/json
// values as plain text — never HTML — because tool output is untrusted. Lives in
// the contract layer so plugins ship data, never a component.
export type ActivityView = {
  title: string
  status?: ActivityStatus
  sections: ActivityViewSection[]
  // Optional structured report the host forwards to its capture sink (e.g. a
  // formatter failure the owner wants surfaced with repro context). The owner
  // produces data; the host performs the actual capture. Mirrors
  // PermissionView.report.
  report?: PluginReport
}

// A pure function a tool's owner exposes to map its raw output (and, optionally,
// the call's raw input) to an ActivityView. It mirrors PermissionSummarizer: it
// receives the input so it can present the call's arguments (e.g. the JS source as
// a formatted `code` section), and it may be async so it can lazy-load a formatter.
// Must stay product-agnostic: no React/DOM/window — it only transforms data
// (enforced by scripts/check-boundaries.mjs for plugin packages). The host resolves
// one per tool id and feeds the result into its single generic activity renderer;
// tools without one fall back to the host's neutral default.
export type ActivitySummarizer = (
  output: unknown,
  input?: Record<string, unknown>
) => ActivityView | Promise<ActivityView>

// A product-agnostic, React-free view-model a tool's owner produces from its raw
// permission-request input so the host can render a readable confirmation prompt
// without knowing any specific tool's shape. Each section is drawn by the host's
// single generic permission renderer: a `code` section gets syntax highlighting in
// the named language; a `json` section is shown as a serialized dump. Lives in the
// contract layer so plugins ship data, never a component. Mirrors ActivityView.
export type PermissionViewSection =
  | { kind: 'code'; label: string; language: string; code: string }
  | { kind: 'json'; label: string; value: unknown }

export type PermissionCodeSection = Extract<PermissionViewSection, { kind: 'code' }>
export type PermissionJsonSection = Extract<PermissionViewSection, { kind: 'json' }>
export type JsonViewSection = ActivityJsonSection & PermissionJsonSection

export type PermissionView = {
  sections: PermissionViewSection[]
  // Optional structured report the host forwards to its capture sink (e.g. a
  // formatter failure the owner wants surfaced with repro context). The owner
  // produces data; the host performs the actual capture. Mirrors
  // PluginCaptureError.report.
  report?: PluginReport
}

// A mapper a tool's owner exposes to turn a permission request's raw input into a
// PermissionView. May be async (e.g. it pretty-prints code with a lazily-loaded
// formatter). Must stay product-agnostic: no React/DOM/window — it only transforms
// data (enforced by scripts/check-boundaries.mjs for plugin packages). The host
// resolves one per tool id; tools without one fall back to the host's default JSON
// view of the raw input.
export type PermissionSummarizer = (
  input: Record<string, unknown>
) => PermissionView | Promise<PermissionView>

// === Generic human-in-the-loop prompt (the host's single interactive surface) =====
// A "human prompt" is any request a plugin raises that BLOCKS the run on a person
// answering it in the UI — the Permissions allow/deny gate and the Choice-prompt poll
// today. Rather than each feature shipping its own host capability + modal + per-shell
// mount, a plugin builds this product-agnostic VIEW and awaits the user's answer
// through the single injected `requestHumanInput` capability; the host owns ONE generic
// modal that renders any HumanPromptView and resolves a HumanPromptResult, which the
// plugin maps back to its own outcome (e.g. ToolGateResult or ChoicePromptResult).
// Plugins ship data, never a component (see HumanPromptHost in app-browser). Mirrors how
// PermissionView / ActivityView are plugin-emitted and host-rendered.

// What the host renders for a human prompt. `role`/`ariaLabel` drive the dialog
// semantics and keep stable accessible names; `sections` is a static body; `inputContext`
// asks the host to render the gated tool's input via the owner's `summarizePermission`
// (resolved host-side by tool id, falling back to a JSON dump) — the one cross-plugin
// enrichment only the host can do; `actions` are the mutually-exclusive choices (Allow/Deny
// | poll options); `allowCustom` adds a free-text answer; `dismissLabel` names the
// overlay/Escape exit, and `dismissAction`, when set, adds an explicit dismiss button
// (e.g. a poll's "Skip").
export type HumanPromptView = {
  role: 'dialog' | 'alertdialog'
  ariaLabel: string
  title: string
  description?: string
  sections?: PermissionViewSection[]
  inputContext?: { toolId: string; input: Record<string, unknown> }
  actions: { id: string; label: string; tone?: 'primary' | 'default' }[]
  allowCustom?: boolean
  dismissLabel: string
  dismissAction?: { label: string }
}

// The user's answer to a human prompt: a picked action (by id), a typed custom answer,
// or a dismissal (overlay / Escape / explicit dismiss, or a host-forced settle on run
// abort / conversation reset). The requesting plugin maps this back to its own result.
export type HumanPromptResult =
  | { kind: 'action'; id: string }
  | { kind: 'custom'; text: string }
  | { kind: 'dismissed' }

// An injected capability that shows the host's single human-prompt modal and resolves
// the user's answer. Only hosts that can prompt a human (the browser) provide it; a
// plugin that needs it must tolerate its absence (a gate defaults to allow; a tool
// contributes nothing). Replaces the former requestPermission / requestUserChoice.
export type HumanInputService = (view: HumanPromptView) => Promise<HumanPromptResult>

// The placeholder a `keywordPlannerStep.inputTemplate` uses to stand in for the
// user prompt. Exported so the substitution contract has ONE source of truth: a
// plugin author references this constant in its manifest instead of re-typing the
// literal (a typo like `'{{ prompt }}'` would otherwise ship the literal string as
// the tool argument, silently), and `inferPlan` (app-core) compares against the
// same constant. See KeywordPlannerStep.
export const KEYWORD_PROMPT_SENTINEL = '{{prompt}}'

// A keyword-triggered planner step a tool's owner declares for the heuristic
// fallback planner (used when the LLM planner is unavailable — e.g. an anonymous
// user, or a transport failure). Data-only so a plugin names no host code: the
// host's `inferPlan` matches `keywords` against the prompt and, on a hit, emits a
// step whose `toolCall` targets THIS descriptor's `id` with `inputTemplate`.
// This replaces the previous arrangement where the host hard-coded the `web-search`
// id and its keywords — the keyword logic now travels with the plugin.
export type KeywordPlannerStep = {
  keywords: string[]
  // Step id used in the plan; defaults to the tool id when omitted.
  stepId?: string
  summary: string
  // The tool input to propose. Substitution is SHALLOW / top-level only: a value is
  // replaced by the user prompt iff it is EXACTLY `KEYWORD_PROMPT_SENTINEL`
  // (`'{{prompt}}'`). Nested objects/arrays are passed through verbatim (a sentinel
  // one level deep is NOT substituted), and any other value is emitted as-is. Use
  // the `KEYWORD_PROMPT_SENTINEL` constant, never the bare string literal.
  inputTemplate?: Record<string, unknown>
}

// Planner-facing description of a tool a plugin contributes. Lets a host name the
// tool to its planner/model without instantiating the plugin.
//
// `schema` is the CANONICAL Zod input schema (issue #287): the SAME schema the
// contributed tool's `execute` validates against (`Tool.schema`), not a parallel
// hand-written property map. The host generates the planner-visible JSON Schema
// from it via `toolInputJsonSchema`, so a descriptor can never drift from the
// runtime contract. A plugin author references the one exported Zod schema in both
// places (the descriptor and the tool), giving a single source of truth.
export type PluginToolDescriptor = {
  id: string
  description: string
  schema: ZodSchema<unknown>
  // Optional keyword-fallback planner step (see KeywordPlannerStep). Present only
  // for tools the heuristic planner should be able to propose without an LLM; the
  // host reads it generically, naming no concrete tool id.
  keywordPlannerStep?: KeywordPlannerStep
  // Optional pure mapper from this tool's raw output to an ActivityView the host
  // renders in the turn-activity panel. Keyed by tool id (this descriptor's `id`),
  // so the tool's owner — not the host — decides how its activity is summarized.
  // Product-agnostic (no React/DOM). Omit it and the host uses a neutral default.
  summarizeActivity?: ActivitySummarizer
  // Optional mapper from this tool's raw permission-request input to a PermissionView
  // the host renders in the confirmation prompt. Keyed by tool id, so the tool's
  // owner — not the host — decides how its input is presented (e.g. pretty-printing a
  // code argument). Product-agnostic (no React/DOM); may be async. Omit it and the
  // host shows a neutral JSON dump of the input.
  summarizePermission?: PermissionSummarizer
}

// Host-agnostic metadata about a plugin: the copy a host surfaces in its settings
// UI plus the planner descriptors for the tools the plugin contributes. Lives in
// the contract layer (not inside any concrete plugin) so hosts depend only on the
// abstraction. A plugin ships its own manifest.
export type PluginManifest = {
  id: string
  label: string
  description: string
  toolDescriptors?: PluginToolDescriptor[]
  // Persistent host-surface contribution (the 'status' capability). At most one
  // per plugin: a pure mapper the host resolves to render its generic gauge. See
  // PluginStatusDescriptor.
  statusDescriptor?: PluginStatusDescriptor
  // Developer context-inspector contribution (the 'inspector' capability). At most
  // one per plugin: a pure mapper the host resolves to render its generic request
  // inspector. See PluginInspectorDescriptor.
  inspectorDescriptor?: PluginInspectorDescriptor
  // Default activation when the user has no stored preference. Plugins are
  // off by default (`undefined`/`false`); a plugin that should ship enabled
  // out-of-the-box (e.g. web search) sets this to `true`. An explicit user
  // choice in settings always wins over this default.
  defaultEnabled?: boolean
  // Optional cold-start suggestion the host may surface in the empty-state
  // starter prompts (B3). Contributed here — alongside the other manifest
  // descriptors — so the host derives starters from *enabled capabilities*
  // without hard-coding any concrete plugin id, and never advertises a prompt
  // for a disabled plugin. A short imperative sentence, e.g. "Help debug this
  // code.".
  starterPrompt?: string
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
