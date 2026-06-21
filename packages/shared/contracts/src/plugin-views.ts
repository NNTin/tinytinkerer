// Host↔plugin presentation view-models — the persistent status gauge and the
// developer context-inspector contributions.
//
// WHY THIS LIVES IN contracts (the leaf), not in a plugin package:
// these types are the *boundary contract* between the host and a plugin, in both
// directions. The host PRODUCES the inputs (StatusInput, InspectorEntry — the
// model numbers / the captured request) and RENDERS the outputs (GaugeView,
// InspectorView). A plugin only maps input → output via a pure summarizer. Because
// the host must never statically import a concrete plugin (plugins are discovered
// dynamically via import.meta.glob — see docs/plugin-infrastructure.md), every
// shape that crosses the boundary has to live in a layer the host CAN import:
// contracts. They are split into this dedicated module (rather than swelling
// plugins.ts) to keep that growth contained.
//
// THE RULE (docs/plugin-infrastructure.md): contracts may own host↔plugin
// view-models, but they must stay GENERIC host-render / plugin-emit shapes — never
// a plugin's private heuristics. They are hand-declared types (no Zod): they are
// never `.parse`d, only produced by a plugin and rendered by the host. Keep
// React/DOM out — a plugin ships data, never a component.
//
// ENFORCEMENT: `scripts/check-boundaries.mjs` lists this file in PURE_TYPE_MODULES
// and fails CI if it grows an import, a re-export, a runtime value, or a Zod schema
// — locking the STRUCTURAL invariants above (import-free, schema-free, declaration-
// only). That gate CANNOT see a plugin-SPECIFIC field smuggled into a "generic"
// view-model (e.g. a Tavily-shaped enum on GaugeView) — that is not statically
// decidable, so keeping these shapes generic stays a REVIEW-TIME responsibility.

// === Persistent status contribution (the 'status' capability) ====================
// Unlike ActivityView/PermissionView — which are transient and keyed to a single
// tool invocation — a status contribution is a PERSISTENT, always-visible host
// surface (e.g. a context-usage gauge near the composer). It follows the same
// "plugins ship data, never components" rule: the plugin exposes a pure mapper
// that turns host-provided numbers into a React-free view-model the host's single
// generic gauge renderer draws. No React/DOM in the plugin (enforced by
// scripts/check-boundaries.mjs).

// Threshold bucket for a gauge value, so the host can colour/announce it without
// re-deriving the boundaries the plugin owns.
export type GaugeThreshold = 'healthy' | 'warning' | 'critical'

// The context-usage numbers a status plugin computes. Field names mirror the
// LiteLLM-derived schema so the host can render any of them as a label/tooltip.
export type ContextUsage = {
  context_window: number
  input_tokens_used: number
  input_tokens_remaining: number
  percent_context_used: number
}

// React-free view-model a status plugin produces for the host's generic gauge.
// `value`/`min`/`max`/`unit` are the gauge geometry; `threshold` drives colour +
// a non-colour signal; `context` carries the raw numbers for the label/ARIA.
export type GaugeView = {
  gauge_type: 'context_usage'
  value: number
  min: 0
  max: 100
  unit: 'percent'
  threshold: GaugeThreshold
  context: ContextUsage
}

// What the host feeds the status summarizer. Either field may be absent (model
// limits not surfaced yet, or no usage observed) — the summarizer returns null to
// hide the gauge in that case.
export type StatusInput = {
  contextWindow: number | null | undefined
  inputTokensUsed: number | null | undefined
}

// Pure mapper a status plugin exposes: host numbers → GaugeView, or null to hide.
// Product-agnostic (no React/DOM/window) — it only transforms data.
export type StatusSummarizer = (input: StatusInput) => GaugeView | null

// Manifest descriptor for a persistent status contribution, mirroring
// PluginToolDescriptor. The host resolves `summarizeStatus` from the active
// plugin's manifest and feeds its single generic gauge renderer.
export type PluginStatusDescriptor = {
  id: string
  gaugeType: 'context_usage'
  summarizeStatus: StatusSummarizer
}

// === Developer context-inspector contribution (the 'inspector' capability) =======
// A developer debug surface (issue #270) that shows the EXACT chat request the
// client forwards to the provider per model call — the messages array (system
// prompt + history + tool observations), the model, and stream options. Like the
// status gauge it follows "plugins ship data, never components": the plugin
// exposes a pure mapper turning a host-captured request payload into a React-free
// view-model the host renders (reusing its CodeMirror JSON view). No React/DOM in
// the plugin (enforced by scripts/check-boundaries.mjs).

// One message of a captured request. Product-agnostic (no edge import): `role`
// and `content` mirror the forwarded chat message shape.
export type InspectorRequestMessage = {
  role: string
  content: string
}

// The exact request the client forwarded to the provider for a single model call,
// captured client-side ONLY when the inspector plugin is enabled. `area` marks
// which phase issued it (planning.chat / react.decide / models.chat). This is the
// post-clamp body that reaches the edge, so it equals what the edge forwards.
export type InspectorRequestPayload = {
  model: string
  stream: boolean
  stream_options?: { include_usage?: boolean }
  messages: InspectorRequestMessage[]
  area?: string
  // ISO timestamp of when the request was captured, so the host can label and
  // order multiple captures within a turn.
  capturedAt: string
}

// Token usage reported by the provider for a single model call. All optional —
// providers may report any subset, and rate-limited/error responses report none.
export type InspectorUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

// The outcome of a captured request, paired with it client-side. `pending` is the
// initial state before the response resolves; `rate_limited` is a 429 (rejected
// before the model ran — no tokens consumed); `error` is any other non-OK status;
// `ok` carries the model's response content and any reported usage. Captured only
// while the inspector plugin is enabled and never leaves the client.
export type InspectorResponse =
  | { status: 'pending' }
  | { status: 'rate_limited'; httpStatus: number; retryAfterMs?: number }
  | { status: 'error'; httpStatus: number; message?: string }
  | { status: 'ok'; httpStatus: number; content: string; usage?: InspectorUsage }

// A captured request together with its response outcome — the unit the inspector
// store retains and the plugin maps to a view.
export type InspectorEntry = {
  request: InspectorRequestPayload
  response: InspectorResponse
}

// One message row in the inspector view: the original role/content plus a rough
// per-message token estimate and whether it is a system prompt (called out
// distinctly by the host). The estimate is a char/4 heuristic — clearly an
// approximation, not a tokenizer count.
export type InspectorMessageView = {
  index: number
  role: string
  isSystem: boolean
  content: string
  approxTokens: number
}

// Display-ready view of a captured response the host renders beneath the request.
// `label` is a short human status; `note` explains a non-obvious outcome (e.g. that
// a rate-limited call consumed no tokens); `content`/`usage` are present only for an
// `ok` response, with `approxResponseTokens` a char/4 estimate for the output.
export type InspectorResponseView =
  | { status: 'pending'; label: string }
  | { status: 'rate_limited'; label: string; note: string; retryAfterMs?: number }
  | { status: 'error'; label: string; message?: string }
  | {
      status: 'ok'
      label: string
      content: string
      usage?: InspectorUsage
      approxResponseTokens: number
    }

// React-free view-model the inspector plugin produces from a captured payload.
// `rawJson` is the pretty-printed forwarded body for the host's JSON renderer and
// copy-to-clipboard; `approxTotalTokens` sums the per-message heuristic estimates.
export type InspectorView = {
  model: string
  stream: boolean
  // Serialized `stream_options` for display (e.g. `{"include_usage":true}`).
  streamOptions: string
  area?: string
  messageCount: number
  approxTotalTokens: number
  messages: InspectorMessageView[]
  rawJson: string
  // The paired response outcome (pending until it resolves).
  response: InspectorResponseView
}

// Pure mapper a context-inspector plugin exposes: a captured request+response
// entry → InspectorView. Product-agnostic (no React/DOM/window) — only data.
export type InspectorSummarizer = (entry: InspectorEntry) => InspectorView

// Manifest descriptor for the developer context-inspector contribution, mirroring
// PluginStatusDescriptor. The host resolves `summarizeRequest` from the active
// plugin's manifest and feeds its single generic inspector renderer.
export type PluginInspectorDescriptor = {
  id: string
  summarizeRequest: InspectorSummarizer
}
