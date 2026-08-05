---
sidebar_position: 1
---

# Plugin Infrastructure

TinyTinkerer supports optional **plugins** that contribute tools to the agent runtime. A plugin
implements the product-agnostic contract from `@tinytinkerer/contracts`, lives as its own
package under `packages/plugins/*`, and is **discovered dynamically** by the host — the host
never imports a concrete plugin by name. Plugins are activated/deactivated per-user in the
Settings Modal and gated by that activation state when a chat run builds its runtime.

The plugin contract (the plugin SDK) and the `Tool` interface live in `contracts`, the leaf
package, so a plugin package depends **only** on `contracts`. `agent-core` owns the plugin
_runtime_ (the `PluginRegistry`, the hook runners, and the `ToolRegistry`) and re-exports the
contract so its public surface is unchanged for existing consumers (`app-core`, `app-browser`).

The repo currently ships ten plugins under `packages/plugins/*`: **Feedback**
(`send_feedback`), **Event logger** (a `chat.event` observer hook), **Permissions** (a
`tool.beforeExecute` gate), **Web search** (the Tavily `web-search` tool), **Code execution**
(the `run_javascript` sandbox tool), **Browser state** (the `read_dom` page-reading tool),
**Choice prompt** (the `ask_user` human-in-the-loop tool), **Context usage** (a status plugin —
the `statusDescriptor` context-window gauge), **Context inspector** (an inspector plugin —
the `inspectorDescriptor` developer panel showing the exact forwarded LLM request), and
**Tool picker** (a tool-tree plugin — the `toolTreeDescriptor` compose-area picker described
under [Per-tool enablement](#per-tool-enablement--the-tool-picker-plugin-tinytinkererplugin-tool-tree)
below). A plugin
contributes tools and/or hooks — or, like the two context plugins, neither: just a pure
view-model mapper on a manifest descriptor the host reads — and may use a host-injected
capability (telemetry capture, a **human-in-the-loop prompt** — the one surface behind both the
permissions gate and the choice poll — an edge request, a code sandbox, or a DOM read) without
importing the host.

> **Decoupling:** `app-browser` has **no static dependency** on any concrete plugin — not in its
> `package.json`, not as an import. It depends only on the `PluginModule` contract in
> `contracts`. A plugin package can be added or removed from `packages/plugins/*` and the project
> still type-checks and builds; the plugin's tools simply appear or disappear. See
> [The plugin catalogue](#the-plugin-catalogue-tinytinkerercatalogue).

See also:

- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)
- [packages-concept.md](../architecture/packages-concept.md)
- [sentry-telemetry.md](../architecture/sentry-telemetry.md)
- [mcp-integration.md](./mcp-integration.md) — the closest existing pattern (settings-gated tools)
- [Build a plugin](./build-a-plugin.md) — a task-oriented walkthrough that builds one small,
  compiling plugin from this contract
- [Plugin & tool-picker impact lab](./plugin-tool-picker-lab.mdx) — a live, hands-on demo of the
  tool-tree picker described below
- [PRIVACY.md](../overview/PRIVACY.md) — feedback content is sent via telemetry on purpose

---

## The plugin contract (`contracts`)

`packages/shared/contracts/src/plugins.ts` owns the product-agnostic plugin contract (the plugin
SDK) and the pure `Tool` interface. Being the leaf package it imports only `zod` (and its own
local modules), so a plugin built against it carries no browser, telemetry, or app dependency.
`agent-core` re-exports this contract (and `Tool`) so its public surface is unchanged.

```ts
interface AgentPlugin {
  id: string
  createTools?(host: PluginHost): Tool<unknown, unknown>[]
  createHooks?(host: PluginHost): AgentHookContribution[] // chat.event observers / tool.beforeExecute gates
  activate?(host: PluginHost): void | Promise<void>
  deactivate?(): void | Promise<void>
}

interface PluginHost {
  capture: PluginCaptureSink // always present; forwards reports out-of-band (telemetry)
  requestHumanInput?: HumanInputService // optional; the ONE human-in-the-loop prompt (issue #85)
  edgeFetch?: PluginEdgeFetch // optional; only hosts with an edge backend
}

// The minimal, runtime-agnostic shape of a tool a plugin contributes.
interface Tool<Input, Output> {
  id: string
  description: string
  schema: ZodSchema<Input> // the SAME schema PluginToolDescriptor.schema advertises (issue #287)
  summarizeActivity?: ActivitySummarizer
  outputSchema?: ZodSchema<Output> // when present, the registry throws on a result that fails it
  awaitsHumanInput?: boolean // governs execution by the human-input budget, not the machine one
  execute(input: Input): Promise<Output>
}

type PluginCaptureSink = (report: PluginReport) => void

// Optional host capabilities. Unlike `capture` (always present), these are
// supplied only by hosts that can back them — the browser provides both; a
// headless host omits them. contracts owns only the *function types*; the host
// implements them. A plugin that needs one must tolerate its absence.
//
// A plugin that needs the user — the permissions gate's allow/deny, the choice
// poll — builds a product-agnostic HumanPromptView and awaits this; the host renders
// its single generic modal and resolves a HumanPromptResult the plugin maps back to
// its own outcome. One capability + one modal replaces the former per-feature
// requestPermission / requestUserChoice (see "The Choice prompt plugin" below).
type HumanInputService = (view: HumanPromptView) => Promise<HumanPromptResult>

type PluginEdgeResponse = { ok: boolean; status: number; json(): Promise<unknown> }
type PluginEdgeFetch = (
  path: string,
  body: unknown,
  options?: { area?: string }
) => Promise<PluginEdgeResponse>

type PluginReport = {
  pluginId: string
  kind: string
  message: string
  level?: 'info' | 'warning' | 'error' // 'info' is captured as a message, not an error issue
  contexts?: Record<string, Record<string, unknown>>
}

class PluginCaptureError extends Error {
  readonly report: PluginReport // routed to host.capture by the registry
}

// Host-agnostic discovery contract. A plugin package's entry module exports a
// `manifest` and a `createPlugin` factory; the host loads it dynamically and
// validates it with `isPluginModule` before trusting it.
// A pure, React-free view-model a tool's owner produces from its raw output so the
// host can render a consistent activity summary without any per-tool branching.
type ActivityViewSection =
  | { kind: 'text'; label: string; value: string } // plain label/value row
  | { kind: 'code'; label: string; language: string; code: string } // read-only, syntax-highlighted
  | { kind: 'json'; label: string; value: unknown } // serialized dump
type ActivityStatus = 'ok' | 'error' | 'warn' | 'unknown'

type ActivityView = {
  title: string // collapsed-summary heading
  status: ActivityStatus // required; drives the row's status styling
  sections: ActivityViewSection[] // sections shown on expand
  report?: PluginReport // optional report the host forwards to its capture sink
}
// May receive the call's raw input (to present arguments) and may be async
// (to lazy-load a formatter).
type ActivitySummarizer = (
  output: unknown,
  input?: Record<string, unknown>
) => ActivityView | Promise<ActivityView>

type PluginToolDescriptor = {
  id: string
  description: string
  // The CANONICAL Zod schema (issue #287) — the SAME schema object the contributed
  // Tool.execute validates against, not a hand-written parallel JSON Schema. The host
  // generates the planner-visible JSON Schema from this one source of truth.
  schema: ZodSchema<unknown>
  keywordPlannerStep?: KeywordPlannerStep // optional heuristic-planner fallback step
  summarizeActivity?: ActivitySummarizer // owns this tool's turn-activity presentation
  summarizePermission?: PermissionSummarizer // owns this tool's permission-prompt presentation
}

type PluginManifest = {
  id: string
  label: string // Settings toggle copy
  description: string
  toolDescriptors?: PluginToolDescriptor[] // planner descriptors for the plugin's tools
  statusDescriptor?: PluginStatusDescriptor // persistent status-gauge contribution
  inspectorDescriptor?: PluginInspectorDescriptor // developer context-inspector contribution
  toolTreeDescriptor?: PluginToolTreeDescriptor // compose-area tool-picker contribution
  defaultEnabled?: boolean // ships on out-of-the-box when true (e.g. web search)
  settingsDescriptor?: PluginSettingsDescriptor // user-configurable fields the host renders
}

type PluginModule = {
  manifest: PluginManifest
  createPlugin: () => AgentPlugin
}

function isPluginModule(value: unknown): value is PluginModule // runtime guard
```

This mirrors the real contract in `packages/shared/contracts/src/plugins.ts`, trimmed to the
shapes referenced on this page — see that file (or
[Build a plugin](./build-a-plugin.md), which compiles against it) for every field.

`PluginManifest`/`PluginModule` live in the **contract layer**, not inside any concrete plugin,
so the host depends only on the abstraction. `isPluginModule` keeps dynamic loading best-effort:
an absent or malformed module is rejected here rather than throwing into host construction. The
browser host performs the final validation after instantiating the plugin: `createPlugin().id`
must match `manifest.id`, and duplicate plugin ids are ignored after the first valid plugin.

**Where view-models live.** The status-gauge and context-inspector view-models
(`GaugeView`/`StatusInput`, `InspectorView`/`InspectorEntry`, etc.) live in `contracts`
(`src/plugin-views.ts`), split out of `plugins.ts` to contain their growth. They belong in
`contracts` — not in the plugin packages — because they are the host↔plugin **boundary contract** in
both directions: the host **produces** the inputs (the model numbers, the captured request) and
**renders** the outputs, while the plugin only maps input→output via a pure summarizer. Since the
host must never statically import a concrete plugin, every shape that crosses the boundary has to
live in a layer the host can import. The rule: `contracts` may own these view-models, but they must
stay **generic** host-render / plugin-emit shapes — never a plugin's private heuristics — and they
carry no Zod schema (they are produced and rendered, never `.parse`d).

`PluginHost.capture` is an **inversion-of-control sink**, exactly like the telemetry
`setCaptureExceptionSink` in `@tinytinkerer/sentry-telemetry`: `contracts` defines the _type_,
and the host (the browser) supplies the implementation that forwards to Sentry.

## The registry & activation gating (`agent-core`)

`PluginRegistry` collects tools for the **active** plugins only:

```ts
registry.collectTools(activeIds: ReadonlySet<string>, host: PluginHost): Tool[]
```

- A plugin whose id is not in `activeIds` contributes nothing.
- A newly-active plugin gets a one-time `activate(host)` call; a plugin that was active on a
  previous call and is now absent from `activeIds` gets `deactivate()`. Every lifecycle hook is
  best-effort — never awaited, sync/async failures swallowed — so a misbehaving plugin can never
  break runtime construction. In the browser, the chat store owns one runtime factory / plugin
  registry, so lifecycle state is preserved across prompts. A plugin's `createTools` that throws
  is caught and contributes no tools.
- Each contributed tool's `execute` is wrapped so that a thrown `PluginCaptureError` forwards
  its `report` to `host.capture` and is then **rethrown** — the agent runtime's normal
  tool-failure path (`agent.tool.failed`) still runs. The capture call is itself best-effort, so
  a throwing sink never changes the error the runtime observes.
- Tool ids are unique within a runtime. Duplicate ids are skipped before registration in the
  browser host, and the core `ToolRegistry` rejects duplicate registration as a last line of
  defense. A skipped plugin tool does not expose its planner descriptor.

## The Feedback plugin (`@tinytinkerer/plugin-feedback`)

A dedicated package at `packages/plugins/plugin-feedback`, depending only on `contracts`. To be
discoverable it exports the `PluginModule` surface — `manifest` (a
`PluginManifest` with the Settings copy and the `send_feedback` planner descriptor) and
`createPlugin` — plus `FeedbackPendingError`, `feedbackPluginManifest`, `feedbackPlugin()`, and
`SEND_FEEDBACK_PLUGIN_ID` for direct/test use.

Its single `send_feedback` tool takes `{ message, category }` where `category` is the required
enum `'bug' | 'idea'` (validated by `feedbackInputSchema` from `contracts`). The tool description
tells the assistant to invoke it both when the user asks to report a bug / suggest an idea **and**
proactively (as an `idea`) when the assistant hits a limitation in its own environment — a missing
tool, capability, or permission. It then **throws** a typed `FeedbackPendingError`:

```
send_feedback (throws FeedbackPendingError)
        │  carries PluginReport { kind: 'feedback', level: 'info', message, contexts }
        ▼
PluginRegistry tool wrapper  ──catches PluginCaptureError──▶ host.capture(report)  ──▶ Sentry (info message)
        │ rethrows
        ▼
AgentRuntimeBase.runToolCall  ──▶ agent.tool.failed ("send_feedback: not implemented")
```

Feedback is not an error condition, so its report is **`info`-level**: the host captures it as an
informational Sentry _message_ (via `captureMessage`), not an error issue with a synthetic stack
trace. It is then surfaced to the runtime as a graceful tool failure. There is intentionally no
backend.

That final `agent.tool.failed` also reaches `createToolFailureTelemetryHook`, which independently
captures a generic, `error`-level "tool failed" exception under its own `tool-failure` fingerprint
— so a `PluginCaptureError` throw now produces two Sentry entries, not one. See
[sentry-telemetry.md § Tool failures](../architecture/sentry-telemetry.md#tool-failures).

## The Web search plugin (`@tinytinkerer/plugin-web-search`)

The Tavily web-search tool ships as its own plugin package at
`packages/plugins/plugin-web-search`, depending only on `contracts`. It exports
the `PluginModule` surface — `manifest` (a `PluginManifest` whose single `toolDescriptor` keeps the
stable id `web-search`) and `createPlugin` — plus `webSearchPlugin()`, `webSearchPluginManifest`,
and `WEB_SEARCH_PLUGIN_ID` for direct/test use. The plugin also owns its turn-activity
presentation: `summarizeWebSearchActivity` (wired onto the descriptor's `summarizeActivity`) maps
the Tavily `{ query, results }` output to an `ActivityView` (title `Web search`, a `Results` count,
and a `Query` section), so the host no longer special-cases the `web-search` tool id.

Its single `web-search` tool POSTs a `SearchRequest` (`{ query, maxResults? }`, validated by
`searchRequestSchema` from `contracts`) to the edge `/api/search` route and parses the
`SearchResponse`. The tool needs the edge, but a plugin package must stay product-agnostic — it
cannot import `app-browser`, its `edgeFetch`, or the telemetry SDK. So it builds against the
injected **`PluginHost.edgeFetch`** capability instead:

```
web-search tool.execute(input)
        │  host.edgeFetch('/api/search', input, { area: 'search' })   ← injected capability
        ▼
app-browser pluginEdgeFetch  ──▶ edgeFetch (request telemetry preserved)
        │  returns { ok, status, json() }   ← json() = parseJsonWithTelemetry (parse telemetry stays host-side)
        ▼
web-search tool  ──▶ searchResponseSchema.parse(...)  (schema validation = plugin/contracts concern)
```

`contracts` owns only the `PluginEdgeFetch` _type_; `app-browser`'s `create-runtime.ts` implements
it from the runtime's existing `edgeFetch`, so **request** telemetry (`http_error`, `network`,
`abort`, the 429 cooldown triage) rides along unchanged, and **response-parse** telemetry stays on
the host side of the capability. `createTools(host)` returns no tool when `host.edgeFetch` is absent
(a headless host), exactly mirroring how the permissions plugin tolerates a missing
`requestHumanInput`.

**Activation is generic, just default-on.** Web search is a normal discovered plugin: it appears in
the generic plugin-activation list and is toggled through `pluginActivation` like every other
plugin. Its manifest sets `defaultEnabled: true`, so it ships enabled out-of-the-box; an explicit
user choice (on or off) always wins over that default. There is no dedicated search setting,
readiness gate, or special-cased plugin id in the host — `create-runtime.ts` activates plugins
purely via `isPluginEnabled(activation, manifest)`.

**The heuristic planner step travels with the plugin.** When the LLM planner is unavailable (an
anonymous user, or a transport failure), the host falls back to `inferPlan` (in `app-core`). That
fallback names **no concrete tool**: a tool descriptor may carry an optional `keywordPlannerStep`
(`{ keywords, stepId?, summary, inputTemplate? }`), and `inferPlan` proposes a step for any active
tool whose keywords match the prompt, substituting the `{{prompt}}` sentinel in `inputTemplate`. Web
search ships its own `keywordPlannerStep` (the search keywords used to live hard-coded in
`inferPlan`); because an inactive plugin's descriptor is simply absent from the active set, toggling
the plugin remains the single source of truth for whether the heuristic planner proposes a search
step — now without the host hard-coding the `web-search` id.

## The Code execution plugin (`@tinytinkerer/plugin-code-exec`)

The code-execution tool ships as its own plugin package at
`packages/plugins/plugin-code-exec`, depending only on `contracts`. It exports the `PluginModule`
surface — `manifest` (a `PluginManifest` whose single `toolDescriptor` keeps the stable tool id
`run_javascript`) and `createPlugin` — plus `codeExecPlugin()`, `codeExecPluginManifest`,
`codeExecInputSchema`, `CodeExecHostError`, and `CODE_EXEC_PLUGIN_ID` for direct/test use. Its
manifest sets **no** `defaultEnabled`, so it ships **off** — the user opts in via Settings. It owns
its turn-activity presentation too: `summarizeCodeExecActivity` (wired onto the descriptor's
`summarizeActivity`) maps the `{ ok, result, logs, timedOut, error }` outcome to an `ActivityView`
(title `Ran JavaScript`; `ok`/`warn`/`error` status; `Result`/`Logs`/`Timed out`/`Error` sections),
replacing the misleading `(no output)` the host's old MCP-shaped fallback showed for a successful
run.

Running arbitrary code is the one capability a plugin must **never** implement itself. A plugin's
`execute()` runs in the browser app runtime, so `eval`/`new Function`/an embedded interpreter there
would inherit **app-origin** access — `localStorage`, IndexedDB, cookies, the auth-bearing
`fetch`, the current URL, the parent DOM, and any in-memory service reachable by closure. So the
plugin stays product-agnostic and only describes _what_ to run; the host owns the isolation
boundary entirely, behind a new injected **`PluginHost.executeSandboxedCode`** capability:

```
run_javascript tool.execute({ code, input? })
        │  host.executeSandboxedCode({ code, input?, timeoutMs? })   ← injected capability
        ▼
app-browser createSandboxExecutor()  (packages/app/app-browser/src/sandbox-executor.ts)
        │  fresh hidden iframe per run, killed after completion / timeout
        ▼
   { ok, result?, logs, timedOut, error? }   ← untrusted; coerced by normalizeResult, never HTML
```

`contracts` owns only the `SandboxCodeExecutor` / `SandboxExecutionRequest` /
`SandboxExecutionResult` _types_; `app-browser` implements the executor. `createTools(host)` returns
no tool when `host.executeSandboxedCode` is absent (a headless host), exactly mirroring how the
web-search plugin tolerates a missing `edgeFetch`. A normal failed run — a thrown user error or a
timeout — comes back as a resolved `{ ok: false, … }` and is returned to the agent so the model can
react to its own bad code; only an _unexpected_ executor failure is thrown as a capturable
`CodeExecHostError` (a `PluginCaptureError`, so the registry routes it to `host.capture`).

**The browser isolation boundary** (`sandbox-executor.ts`). Per run, the host:

- creates a **fresh hidden iframe** with `sandbox="allow-scripts"` only — **never**
  `allow-same-origin`, so the iframe runs at an **opaque origin** and cannot read the parent DOM,
  storage, cookies, or the app URL — plus `referrerPolicy="no-referrer"` (no current-site leak).
- injects a **static** bootstrap document via `srcdoc` (the user's code never appears in the HTML;
  it arrives at runtime via `postMessage`, so nothing the agent supplies is parsed as HTML). The
  document carries an in-document CSP that blocks all network/resource loads — `default-src 'none';
connect-src 'none'; img-src 'none'; …; worker-src blob:; script-src 'unsafe-inline'` (no
  `'unsafe-eval'`).
- runs the user code inside a **Worker** the iframe builds from a `blob:` URL, with the code
  embedded as an async function body (so no `eval`/`new Function`). The worker runs on its own
  thread, so blocking code (e.g. `while(true)`) cannot stop the timeout from terminating it.
- enforces resource controls: **10 s** timeout (worker terminated; the embedder also has a hard
  backstop that destroys the iframe), **~4 M-char** captured-output cap enforced **both** inside the
  worker **and** again host-side on the untrusted reply (so it never depends on the worker honoring
  its own cap), **1 MB** code cap (in the plugin's zod schema), and **≤ 3** concurrent sandboxes;
  the iframe is **destroyed after every run** (success, error, or timeout).
- enforces a **strict message boundary**: the embedder accepts a reply only from that iframe's
  exact `contentWindow` and only with the matching `nonce`, then coerces the untrusted payload
  (`normalizeResult`) — `result` is opaque data callers never render as HTML, logs are filtered to
  strings and capped.

**Human gate.** Execution is _encouraged_ to have explicit user approval but it is not mandatory.
Because `run_javascript` is an ordinary tool, enabling the **Permissions plugin** alongside it makes
every run pause for an Allow/Deny prompt through the existing `tool.beforeExecute` gate — no bespoke
modal. Off by default, it is one toggle the user controls.

**Residual risk.** Browser sandboxing is not a VM. This design does not protect against browser
engine vulnerabilities, CPU/memory denial-of-service before the timeout fires, fingerprinting via
allowed browser APIs, or timing side channels. A server/container/WASM isolate is out of scope; for
browser-only execution the opaque-origin iframe + CSP + Worker + strict messaging is the minimum
defensible design.

## The Browser state plugin (`@tinytinkerer/plugin-browser-state`)

The browser-state tool ships as its own plugin package at `packages/plugins/plugin-browser-state`,
depending only on `contracts`. It exports the `PluginModule` surface — `manifest` (a
`PluginManifest` whose single `toolDescriptor` keeps the stable tool id `read_dom`) and
`createPlugin` — plus `browserStatePlugin()`, `browserStatePluginManifest`, `readDomInputSchema`,
`BrowserStateHostError`, and `BROWSER_STATE_PLUGIN_ID` for direct/test use. Its manifest sets **no**
`defaultEnabled`, so it ships **off** — the user opts in via Settings. It owns its turn-activity
presentation: `summarizeReadDomActivity` (wired onto the descriptor's `summarizeActivity`) maps the
`{ url, matchedCount, nodes, truncated }` result to an `ActivityView` (title `Read page DOM`,
`Matched`/`Returned`/`URL` sections, `ok` when something matched and `warn` when nothing did).

The tool makes the assistant **aware of the page the user is looking at** so it can answer questions
about what is on screen and debug rendering (e.g. a Mermaid diagram that is not showing). It reads
the page through narrow queries — never a full-page dump, which would pollute the model's context
window — and resolves to one of **three modes** (so the agent can both find content and reason about
where it sits):

- **Outline (no `selector`)** → page meta plus a depth-limited **structural tree** of the page
  (`tag`/`id`/`classes`/`childCount` + a short direct-text preview, nested to `depth`, default 4).
  Crucially this is **recursive**: a client-rendered SPA mounts its whole UI under one
  `<div id="root">`, so a shallow body-children listing only ever shows `div#root`. The recursive
  outline reveals that subtree in a single call, letting the agent pick a precise selector or the
  right region.
- **Region (`region: 'top' | 'bottom'`)** → the rendered "content" elements (those with a layout box
  and either their own text or an interactive tag) ordered by their **absolute vertical position** on
  the page (bottom = furthest down first). This answers "what's at the bottom/top of the page"
  directly, instead of the document-order, first-N slicing that always favoured the top.
- **Selector** → the matched elements with the requested `include` fields
  (`html`/`text`/`attributes`/`rect`); `depth` additionally nests each match's descendants as
  `children` so the agent can pull a bounded subtree of a container.

The agent can chain a returned `html` string into the `run_javascript` tool (the code-exec plugin)
for heavier parsing. The two plugin **packages** stay independent (neither imports the other, and
each is product-agnostic), but the host **does** wire a deliberate channel between them — see
**The dom-snapshot channel** below. `run_javascript`'s sandbox cannot reach the live page itself, so
all page data still originates from a `read_dom` read; the host carries it across.

### The dom-snapshot channel (a deliberate host coupling)

This is the **one** host↔plugin coupling the plugin system keeps by design, rather than driving from
the manifest. On every `read_dom` call the host captures the full sanitized page into a
runtime-scoped snapshot, and the sandbox executor exposes that snapshot to `run_javascript` as a
`dom` binding — so the agent can read a cheap narrow view with `read_dom` and then compute over the
whole (already-redacted) page in the sandbox, which cannot read the page on its own. The capture is
**gated on a sandbox consumer being registered**: `create-runtime.ts` only builds the whole-body
snapshot when a `run_javascript` tool actually registered (the lone remaining host literal,
`RUN_JAVASCRIPT_TOOL_ID`), so a `read_dom` with no sandbox to feed never pays for — nor exposes — the
deep clone. Sandboxed code therefore **does** receive first-party page content (the `read_dom`
snapshot), but it adds **no new outbound data path**: the sandbox runs at an opaque origin with the
network blocked by its in-document CSP, so it can compute over the snapshot but cannot transmit it.
The only place page content leaves the device remains the model provider — already disclosed by the
`read_dom` section of `PRIVACY.md` — so this internal flow needs no separate privacy disclosure.

Reading the live DOM is the one capability a plugin must **never** implement itself — a plugin's
`execute()` runs in the browser app runtime, so touching the page there would inherit app-origin
access and trip the product-agnostic boundary check. So the plugin stays product-agnostic and only
describes _what_ to read; the host owns DOM access entirely, behind an injected
**`PluginHost.readDom`** capability:

```
read_dom tool.execute({ selector?, region?, depth?, include?, maxNodes?, maxChars? })
        │  host.readDom(query)   ← injected capability
        ▼
app-browser createDomReader()  (packages/app/app-browser/src/dom-reader.ts)
        │  outline | region | selector; reads THIS shell's own document;
        │  caps node count / tree depth+breadth / payload size; redacts form values
        ▼
   { url, title, viewport, matchedCount, nodes, truncated }   ← nodes may nest `children`; form values stripped
```

`contracts` owns only the `DomReader` / `DomQuery` / `DomReadResult` / `DomNodeResult` _types_;
`app-browser`'s `create-runtime.ts` implements the capability from `createDomReader()`.
`createTools(host)` returns no tool when `host.readDom` is absent (a headless host), exactly
mirroring how the web-search plugin tolerates a missing `edgeFetch` and the code-exec plugin a
missing `executeSandboxedCode`. A bad selector comes back as a resolved `{ matchedCount: 0 }` result
the agent can correct, not a throw; only an _unexpected_ host failure is thrown as a capturable
`BrowserStateHostError` (a `PluginCaptureError`, so the registry routes it to `host.capture` — its
report carries **no** page content).

**Host-side caps + redaction** (`dom-reader.ts`). The host reads only the current shell's own
`document` (never a sandboxed or cross-origin iframe), clamps `maxNodes` (default 25, hard cap 100)
and per-field `maxChars` (default 4000, hard cap 20000) regardless of what the tool requests, and
bounds the outline/subtree tree independently — `depth` clamped to ≤ 8, ≤ 25 children expanded per
node, and a global ≤ 400-node budget — so a deep tree can never produce an unbounded payload, and a
single node serializes at most 60 attributes. It **redacts editable content before returning**: it
serializes a detached clone with the `value`/`checked` attributes stripped from every
input/textarea/select, textarea default text blanked, password inputs redacted, a `<select>`'s
`selected` state removed, and `contenteditable` regions blanked — plus inline `on*` event handlers
and `<iframe srcdoc>` stripped for minimal exposure — so text the user typed but has not sent is
never shipped to the model (the outline likewise never previews a form field's or editor's text).
Because `read_dom` sends first-party page content to the model provider when invoked, it is disclosed
in `PRIVACY.md` (see the "Browser state plugin (read_dom)" section).

## The Choice prompt plugin (`@tinytinkerer/plugin-choice-prompt`)

The choice-prompt tool ships as its own package at `packages/plugins/plugin-choice-prompt`,
depending only on `contracts`. It exports the `PluginModule` surface — `manifest` (a
`PluginManifest` whose single `toolDescriptor` keeps the stable tool id `ask_user`) and
`createPlugin` — plus `choicePromptPlugin()`, `choicePromptPluginManifest`,
`summarizeChoicePromptActivity`, `CHOICE_PROMPT_PLUGIN_ID`, and `ASK_USER_TOOL_ID` for direct/test
use. Its manifest sets **no** `defaultEnabled`, so it ships **off** — the first interactive
human-in-the-loop tool blocks the run on the user, so it is opt-in.

This is the first **two-way** surface (issue #85): the agent can ask the **user** a question with a
set of `options` and (when `allowCustom`) a free-text answer, and the user's selection folds back into
the run as the tool's result. Crucially it is an agent-**invoked tool** (like `web-search`), not a
hook gate — its `execute` BLOCKS until the user answers, then returns the answer:

```
ask_user tool.execute({ question, options, allowCustom })
        │  builds a HumanPromptView (a 'dialog' poll: options → actions, allowCustom, a Skip dismiss)
        │  host.requestHumanInput(view)   ← the ONE injected human-in-the-loop capability
        ▼
app-browser requestHumanInput  → enqueues the view on the owning app's prompt store → that app's <HumanPromptHost/> resolves it
        │  { kind: 'action', id } | { kind: 'custom', text } | { kind: 'dismissed' }   ← generic HumanPromptResult
        ▼
ask_user maps it back → { kind: 'option', value } | { kind: 'custom', text } | { kind: 'dismissed' }   ← tool result (#276)
```

There is **no choice-specific host code**: `contracts` owns the generic `HumanInputService` /
`HumanPromptView` / `HumanPromptResult` view-models plus the choice tool's own `ChoicePromptResult` and
the canonical `choicePromptInputSchema` / `choicePromptResultSchema`; the plugin builds the view and
maps the answer (pure, product-agnostic — no React, enforced by `check-boundaries.mjs`), and
`app-browser`'s `create-runtime.ts` wires the one `requestHumanInput` capability
(`human-prompt-bridge.ts`) which a single generic `<HumanPromptHost/>` resolves. `createTools(host)`
returns no tool when `host.requestHumanInput` is absent (a headless host), exactly mirroring how
web-search tolerates a missing `edgeFetch`. The poll is **self-describing**, so unlike the permission
prompt it carries no `inputContext` body — only a `summarizeActivity` for the durable transcript record
(the question asked + the answer given).

**Human-input tools are a runtime concept, not a host hack.** Because a person cannot beat the 10s
machine `toolTimeoutMs`, the `Tool` contract carries an `awaitsHumanInput` flag. The runtime
(`agent-runtime-base.ts`) uses it for exactly **one** thing: it governs the tool's execution by the
human-input budget (`humanInputTimeoutMs`, ~5 min — the same budget that governs the Permissions hook
gate, renamed from `humanHookTimeoutMs` since it now covers tools too). The runtime does **not** skip
the gate chain; instead it surfaces the flag on `ToolExecutionContext.awaitsHumanInput`, and the
**permissions gate self-exempts** a human-input tool there (`plugin-permissions`), returning `allow`
without prompting — gating a tool that already asks the user would be a prompt-to-show-a-prompt.
Keeping the exemption in the gate (keyed on the context flag, not a tool id) means a future
non-permission `tool.beforeExecute` gate **still runs** for human-input tools, and the runtime owns
only the budget while the gate owns the exemption.

**Dismissal vs. timeout.** A user who closes the prompt resolves a structured `{ kind: 'dismissed' }`
result — a normal "the user declined" outcome the model reacts to — **not** a tool failure. The host
also settles any open prompt when the run is aborted (Stop) or the conversation is reset
(`chat-store.ts` → the queue's `reset(conversationId)`, scoped per conversation since issue #430), so
a prompt never outlives its run. Only a poll the host never answers within the human-input budget
surfaces as a tool failure.

## The human-prompt host (`app-browser`)

Everything from here to the end of this section is HOST machinery rather than choice-prompt
behaviour: the permissions gate reaches exactly the same queue, renderers and ownership rules, and a
future human-in-the-loop surface will too. It sits beside the choice plugin because that plugin was
its first user, not because it belongs to it.

**One generic human-prompt surface — no per-feature host code.** The Permissions allow/deny prompt and
the Choice poll are the same machinery, so the host owns exactly **one** of everything per `BrowserApp`:
one capability (`requestHumanInput`), one store of pending `HumanPromptView`s (`human-prompt-bridge.ts`),
and one generic modal (`<HumanPromptHost/>`), mounted by whichever of that app's `BrowserAppShell`s owns
it — never named per-shell, and never two at a time. A plugin owns its prompt entirely: it builds
the `HumanPromptView` (title, `actions`, `allowCustom`, a `dismissAction`) and maps the generic
`HumanPromptResult` back to its own outcome — the permissions gate to a `ToolGateResult`, the choice tool
to a `ChoicePromptResult`. The **one** cross-plugin concern only the host can do stays host-side and
generic: a view's optional `inputContext: { toolId, input }` is rendered via the **gated tool owner's**
`summarizePermission` (resolved by tool id across all manifests, falling back to a JSON dump) — so the
permission body still travels with the tool it describes, not with the permissions plugin. The chat-store
settles its app's open prompts on abort/reset, so the run lifecycle names no feature and a future HITL
surface needs no new service, component, or shell mount — just the `HumanPromptView`.

**The queue belongs to a `BrowserApp`, not to the module (issue #489).** It was a module-level singleton
until a document could hold more than one app — the documentation assistant beside its live labs. Because
every reader resolves the prompt's surrounding data (the per-plugin `presentation` setting, the
conversation title, which conversation ids exist) from the app it is mounted under, one shared queue meant
a prompt raised by app A was drawn with app B's answers to all three. `createBrowserApp` now builds one
store per app and hands its two actions — `request` and `reset` — down to the chat store and the runtime,
which is why `createRuntime` takes `requestHumanInput` as an option instead of importing one. A runtime
built without it exposes **no** `requestHumanInput` capability at all, the same graceful degradation a
headless host gets, rather than falling back to somebody else's queue.

Several shells and surfaces can still share one app (apps/host's root composition renders three `ChatApp`s;
every docs `<LiveLab>` mounts its own shell over one lab app), and the two presentations treat that
differently on purpose:

- the **composer dock** is part of a chat surface, so every surface of one session shows that session's
  question, and answering through any one settles it everywhere. Each dock's free-text field gets its own
  `useId` so two visible docks cannot share a label target.
- the **modal** is an app-level interrupt — a full-viewport overlay with `aria-modal="true"` — so exactly
  one shell per app draws it. `human-prompt-host-ownership.ts` elects the first-mounted shell and hands
  ownership on if it unmounts, without disturbing the pending prompt (the queue is on the app, not the
  renderer). Two overlays for one question would mean two dialogs claiming the document and two entries
  competing in the shared focus stack.

Ownership is per app, not per document: two different apps may each hold a modal at once, and the stack in
`use-dialog-focus.ts` keeps only the topmost interactive. Serializing them across apps would block one
app's run on another's unanswered question.

**Whether an app can prompt at all is one value.** `createBrowserApp`'s `humanInput` option (default `true`)
decides whether the queue exists, and everything downstream reads that: the runtime exposes
`requestHumanInput` iff the queue exists, and a shell mounts a modal iff the queue exists. It was briefly
two independent switches — an app-level queue and a per-shell `globalHosts.humanPrompt` flag — and set
inconsistently those produce the worst available outcome: a plugin raises a prompt into a queue no renderer
draws, and the run blocks invisibly until the human-input budget expires.

**Selectable presentations (the generic per-plugin settings subsystem).** A human prompt can be drawn in
more than one place, chosen by the user. A `HumanPromptView` carries `source` (the originating plugin id)
and the host resolves a per-plugin **presentation** preference for it: `modal` (a centered overlay — the
default, and the only fit for the permissions allow/deny interrupt) or `composer` (a panel docked directly
above the message box). Two renderers subscribe to their app's human-prompt store — `HumanPromptHost` (modal,
mounted by `BrowserAppShell`) and `HumanPromptComposerDock` (placed by each shell above its composer, the
way the shells already place `ContextGaugeSlot`) — and each draws the head-of-queue prompt only when the
resolved presentation matches, so exactly one shows; both reuse the shared `HumanPromptControls`. A view
with no `source` (the permissions prompt) is always the modal.

The choice is the first user of a **generic per-plugin settings subsystem**: a plugin declares typed fields
in `PluginManifest.settingsDescriptor` (an `enum` → a dropdown, a `boolean` → a toggle); the host renders
them generically in that plugin's Settings row (only while it is enabled), persists the values as
`PluginConfigState` (`Record<pluginId, Record<settingKey, string | boolean>>`, key `settings_plugins_config`),
and reads them back with `resolvePluginSetting` (stored value, else the field's `default`). The host names no
concrete plugin — the choice-prompt plugin just declares a `presentation` enum (key
`HUMAN_PROMPT_PRESENTATION_SETTING_KEY`) and stamps its id as the view's `source`; the host maps the stored
value to the matching renderer. Settings are **host-consumed** here (the host reads `presentation` to pick
the surface); injecting config _into_ a plugin at execute time is a future extension.

> **Note for #43 (Shared UI Package):** a `choicePrompt` **content node** (`ChoicePromptNode { prompt,
choices }`) already exists in `contracts`/`content-core` as an unused scaffold (no renderer, no
> markdown parser). #85 deliberately does **not** use it: the live poll is a host-rendered modal and the
> durable record is the tool's activity events, so there is a single source of truth. Rendering an
> answered poll **inline in the transcript** as that content node is #43's job — wire a renderer for the
> existing scaffold there rather than duplicating the poll as both an event record and a content node.

## Activation state flow

Activation is stored and orchestrated headlessly, then surfaced in the browser:

```
Settings Modal toggle (app-browser/browser-settings-modal.tsx)
  → settings store action setPluginEnabled (app-browser/stores/settings-store.ts)
  → persistPluginActivation (app-core/settings.ts) → PreferencesStore (IndexedDB)
  ──────────────────────────────────────────────────────────────────────────────
  next chat run:
  chat-store: app.loadPlugins()  (this app's injected catalogue, see below)
    → get-runtime creates a persistent PluginRegistry for the loaded modules
    → create-runtime: isPluginEnabled(activation, manifest) filters modules → PluginRegistry.collectTools()
    → agent-core ToolRegistry  (only active plugins' tools)
```

- **State shape:** `PluginActivationState = Record<pluginId, boolean>` in `contracts`.
- **Default:** `{}` — a plugin with no stored entry falls back to its manifest's
  `defaultEnabled` (off unless the plugin opts in, like MCP servers and telemetry; web search
  opts in). An explicit stored `true`/`false` always wins. `resolveActivePluginIds` returns only
  the explicitly-enabled ids; `isPluginEnabled(activation, manifest)` is the default-aware check
  used by `create-runtime.ts` and the settings toggles.
- **Persistence key:** `settings_plugins_activation`.
- **Planner exposure:** for each active plugin, `create-runtime.ts` adds its
  `manifest.toolDescriptors` to the planner tool descriptors, so the model can name and invoke
  them (e.g. `send_feedback`). Descriptors travel with the plugin — the host hard-codes none.
- **Activity presentation:** a tool's owner may attach an `ActivitySummarizer` to its
  `PluginToolDescriptor.summarizeActivity` — a pure, React-free
  `(output, input?) => ActivityView | Promise<ActivityView>` mapper keyed by tool id. The host's
  turn-activity panel (`turn-activity-panel.tsx`) carries **zero** per-tool branches: it builds a
  `Map<toolId, ActivitySummarizer>` from the discovered manifests and from app-local `Tool`
  instances (`surfaces.tsx`), resolves one per completed tool, and feeds the result to a single
  generic renderer (`title` + status styling collapsed, `sections` rendered by `kind` — text,
  code, or json — on expand).
  Summarizers must set `status`; the contract makes it required so omission is a compile-time
  error. Tools without a summarizer get a neutral `unknown` default and emit a deduplicated
  warning telemetry message after resolution:
  title = tool label; `(no output)` only when output is genuinely empty; otherwise the host shows
  bounded raw JSON output. That fallback is for debuggability, not curation — plugin authors should
  ship `summarizeActivity` for sensitive or verbose outputs. MCP tools are summarized by the MCP
  tool layer (`runtime/mcp-tool.ts`, `summarizeMcpActivity` keyed by the `mcp:*` id pattern), not
  the panel. Output is untrusted: the host renders every `ActivityView` value as text, never HTML.

## Per-tool enablement & the Tool picker plugin (`@tinytinkerer/plugin-tool-tree`)

Activation is per-plugin; issue #400 adds a second, finer axis: a user can keep a plugin
enabled but disable individual tools it contributes. The state and its invariants:

- **State shape:** `PluginToolDisablementState = Record<pluginId, disabledToolIds[]>` in
  `contracts` — a **denylist**. Absence (of the key, the entry, or a tool's name) means
  _enabled_, so the feature is backward compatible and a plugin update that adds a tool ships it
  enabled. A stale tool name from an older plugin version matches nothing at filter time and is
  garbage-collected the next time that plugin's entry is written.
- **Persistence key:** `settings_plugins_disabled_tools`, parsed/persisted in
  `app-core/settings.ts` exactly like activation.
- **Filter point:** registration time. `create-runtime.ts` passes
  `(pluginId, toolId) => isPluginToolEnabled(disabledTools, pluginId, toolId)` into
  `PluginRegistry.collectContributions`; a rejected tool is never registered, and — because
  planner descriptors are only surfaced for tools that actually registered — its descriptor
  never reaches the model. The filter is scoped per plugin so a disabled name under one plugin
  cannot suppress another plugin's identically-named tool. Nothing is rejected at call time. The
  runtime itself is rebuilt **per chat run** (see `chat-store` → `createBrowserRuntimeFactory`),
  so a selection change made in the tool picker takes effect on the **next** prompt — a run
  already in flight keeps the tool set it was built with.
- **The one policy chokepoint:** `applyPluginToolSelection` (app-core). Every selection change
  routes through it: it normalizes against the plugin's _current_ tool ids (the GC above), and
  when a change disables **all** of a plugin's tools it deletes the denylist entry and flips the
  plugin's **activation** off instead — disabling every tool _is_ disabling the plugin, and the
  cleared entry means a later re-enable comes back with every tool checked. The invariant (the
  denylist never encodes "all tools disabled" alongside an enabled plugin) is **maintained on
  every write** that goes through the chokepoint, and **re-established at discovery time** by
  `reconcilePluginToolDisablement` (app-core) — a plugin update landing between sessions (a tool
  renamed/removed) can otherwise leave a stored entry that, against the plugin's new tool list,
  transiently covers every current tool while the plugin is still marked active. The settings
  store's `reconcilePluginTools` action calls it once per session (wired in `app.ts`,
  `initializeBrowserApp`, right after settings hydrate and this app's catalogue resolves) and persists
  only when something actually changed. Readers must still tolerate a transiently-total entry
  between a stale write and the next reconciliation sweep — `isPluginToolEnabled` and the tool
  tree's `'none'` tri-state already do.

The user-facing surface is itself a plugin, `@tinytinkerer/plugin-tool-tree` (id `tool-tree`,
label "Tool picker (tree view)", off by default). Like the context inspector it contributes no
tools and no hooks — only a manifest descriptor (`toolTreeDescriptor`) carrying a pure
`summarizeToolTree` mapper. The host (`app-browser/src/tool-tree.tsx`) renders a compose-area
button when a plugin contributing the descriptor is enabled, builds the `ToolTreeInput` (every
_enabled_ plugin with ≥1 declared tool — a plugin with none has nothing to check and never
appears — plus the app's own tool group, plus the current per-tool enablement), and renders the
returned `ToolTreeView` as a checkbox tree whose changes call the settings store's
`setPluginToolSelection` or `setAppToolSelection`. The panel derives every toggle's denylist from
**host state** (`pluginDisabledTools` / `appToolDisablement` + the full per-owner tool id list),
never from the rendered view — a summarizer's view is display-only and may be lossy
(filter/reorder) for presentation without corrupting persisted state. MCP tools have their own
enablement (per server) and stay out of the tree's scope.

**App tools in the picker (issue #400 follow-up).** An app's always-on tools (e.g. the canvas
shell's Excalidraw verbs) are shown in the same tree as one **app tool group**:

```ts
type AppToolGroup = {
  id: string
  label: string
  tools: AppTool[]
  bindRun?: () => AppToolRunBindings
}
```

It is passed to `createBrowserShellRoot({ appToolGroup })` and held on the `BrowserApp` so
`useToolTree` can read it. `tools` is the group's single catalogue: the list the picker shows AND
the list the runtime registers. `bindRun` is for a group whose tool must act on state as of the
moment a run STARTS rather than the moment it executes — the documentation assistant pins the route
the reader submitted from — and it may only replace a declared tool's `execute`, never its id,
description, schemas or summarizer, so what the reader selected and what the model is handed cannot
diverge (issue #480 re-review). They participate in per-tool disablement, but under a
**separate axis** from plugins because an app has **no activation toggle** — it is intrinsic to
the shell (Excalidraw is always present). So they get their own denylist
(`appToolDisablement`, key `settings_apps_disabled_tools`) and their own chokepoint,
`applyAppToolSelection` (app-core): it normalizes/GCs exactly like the plugin one, but disabling
**every** tool is a _persisted, stable_ state — the group stays visible in the picker with every
box unchecked and nothing is deactivated (contrast `applyPluginToolSelection`, whose all-disabled
branch flips the plugin off and drops it from the tree). Because there is no activation to
desync, `setAppToolSelection` is a single write and needs no discovery-time reconciliation. The
runtime filters app tools at registration in `create-runtime.ts`'s app-tool loop, mirroring the
plugin filter. `useToolTree` returns `appGroupIds` so the panel routes each toggle to the correct
chokepoint. The tree's `'none'` tri-state — noted as barely-reachable for plugins — is a normal
resting state for an app group.

The tool picker sits at the **outer edge** of the manifest-descriptor pattern: a descriptor plugin
earns its keep by owning some **domain mapping** (how to present a captured request, how to read a
gauge). The tool tree's mapper only sorts/derives tri-state/counts — it owns no domain knowledge —
and it is kept as a plugin anyway for consistency with the other descriptor contributions and for
the free opt-in toggle activation already gives every plugin. The next host affordance that has no
domain mapping of its own should be a plain host feature + host setting, not a plugin — don't take
the tool tree as precedent for "any host UI element is a plugin."

## The plugin catalogue (`@tinytinkerer/catalogue`)

`packages/app/catalogue` is the **only** package that knows which concrete plugins exist. It maps
each plugin package's directory name to a dynamic import, and a host asks it for the subset that
host carries:

```ts
const PLUGIN_LOADERS = {
  'plugin-browser-state': () => import('@tinytinkerer/plugin-browser-state')
  // …one line per package under packages/plugins/*
} satisfies Record<string, () => Promise<unknown>>

export const loadPlugins = async (
  names: readonly CataloguePluginName[]
): Promise<PluginModule[]> => {
  const modules: PluginModule[] = []
  for (const name of names) {
    try {
      const mod = await PLUGIN_LOADERS[name]()
      if (isPluginModule(mod)) modules.push(mod) // tolerate-missing / tolerate-malformed
    } catch {
      /* optional plugin failed to load — skip */
    }
  }
  return modules
}
```

### Why a catalogue package rather than a glob in `app-browser`

Discovery used to be a Vite `import.meta.glob` inside `app-browser/src/plugins/registry.ts`. That
was elegant for a single Vite application and wrong for the repository as it now stands (issue
#495):

- **It was bundler-specific.** `import.meta.glob` is a Vite build-time transform with no webpack
  equivalent, and the documentation site builds with webpack (Docusaurus). It had to alias the
  whole module to a stub returning `[]`, which is why `/docs` Settings said "No plugins available"
  while `/widget` listed the product's. A build alias to "no plugins" is not a composition
  boundary; it is the absence of one.
- **It was module-global.** One memoized promise per module, shared by every `BrowserApp` in the
  document — while a documentation page holds two (the global assistant and the shared live-lab
  app), which carry different plugins with independent activation and settings.
- **It slipped past the boundary checker.** `scripts/check-boundaries.mjs` forbids `app-browser`
  from importing a concrete plugin package. A glob pattern is not a module specifier, so the rule
  never applied to the one place that actually reached plugins.

A literal `import('@tinytinkerer/plugin-…')` is understood by Vite _and_ webpack, and each plugin
still becomes its own lazy chunk. The catalogue package is the single place the boundary rule is
opened, and it is opened narrowly: it may import `plugin-*` and `contracts`, and nothing else.

### The catalogue is injected per `BrowserApp`

`app-browser` knows only the `PluginModule` contract. Which plugins a surface carries is a decision
belonging to whoever composes it, so `createBrowserApp` takes it — required, with no default:

```ts
createBrowserApp(config, {
  plugins: () => import('@tinytinkerer/catalogue').then((m) => m.loadProductPlugins())
})
```

Two things about that shape matter:

- **The thunk reaches the catalogue through a dynamic `import()`.** The catalogue is a map of
  per-plugin imports, and a bundler emits that map into whichever chunk references it. A static
  import at the top of a shell's entry module would put the whole map in that shell's **entry**
  chunk — exactly where the old glob sat. Removing it freed ~1.5 kB against a budget that had 24
  bytes of headroom (`apps/shell/src/bundle-size.test.ts`).
- **It is required rather than defaulted.** There are four production call sites and they share no
  chokepoint: `createBrowserShellRoot` (shell, canvas, ide, mermaid, pixel-agents),
  `apps/host/src/main.tsx` (which mounts `BrowserAppShell` itself), and `apps/docs`'
  `createDocsBrowserApp` (both documentation apps). Any default would have silently stripped the
  plugins from whichever site was forgotten.

`createBrowserApp` memoizes the thunk once per app and exposes it as `app.loadPlugins`, so every
surface of that app shares one load — the property the module-global cache used to give the whole
document. `usePluginModules` reads it from context, so no surface has to be told which app it is in.

### Adding a plugin still touches one list

`packages/app/catalogue/tests/catalogue-coverage.test.ts` reads `packages/plugins/*` from the
filesystem and fails if a package is missing from the map, naming the file and the exact line to
add. So the drop-in property survives, with an explicit step instead of an implicit one — and the
same technique (`packages/e2e/fixtures/discover-plugins.ts`) independently derives the e2e plugin
matrix from the filesystem, so a plugin that reaches the catalogue but not a reader fails there.

### Where a surface's subset is declared (issue #501)

Almost every surface carries all of them: `apps/shell`, `canvas`, `ide`, `mermaid`, `pixel-agents`
and `apps/host` each pass `loadProductPlugins()`. The documentation is the only surface today that
carries a **subset**, and it carries two —
`apps/docs/src/docs-runtime/plugin-subsets.ts` names them and records why each exclusion is an
exclusion.

**A subset is declared by the app that owns it, not by the catalogue package.** The alternative —
named profiles exported from `@tinytinkerer/catalogue` — was considered and rejected: the catalogue
is deliberately product-neutral (it exports the map and a generic `loadPlugins(names)`, and the
boundary checker's positive rule is written around that), while the reasons for a subset are
product policy. The documentation's exclusions are arguments about issue #478's grounding and
citation policy; those do not belong in a package every shell imports, and an embedder outside this
repository could not add a profile to it anyway.

So the convention is the shape, and it is this:

1. **One module in the app**, exporting a named
   `as const satisfies readonly CataloguePluginName[]`. The `satisfies` is load-bearing — a plugin
   renamed or removed from the workspace becomes a compile error at every subset that names it,
   wherever those subsets live.
2. **The reason for every exclusion, in that module.** A partial catalogue is fine; an _undeclared_
   partial catalogue is not. A reviewer should be able to read the product decision rather than
   infer it from a list of strings.
3. **A guard test asserting the list by allowlist in both directions.**
   `apps/docs/src/docs-runtime/__tests__/no-dom-access.test.ts` and `__tests__/no-human-prompt.test.ts`
   are the worked examples. An allowlist rather than "does not contain X", so a fourth entry is a
   decision somebody has to argue for in the diff that adds it.

A subset is per-`BrowserApp`, because that is what it physically is: `createBrowserApp({ plugins })`
memoizes one `app.loadPlugins`, and `usePluginModules` reads it from context. Every surface rendered
inside one app therefore shares that app's answer. This is why #472's Pixel Agents Office needs no
subset of its own — it is a portaled surface _inside_ the assistant app, so it inherits
`DOCS_ASSISTANT_PLUGINS` (the tool picker and the context gauge). Giving it a different answer would
mean a second `BrowserApp`, which #472 rejected.

The documentation's own exclusions: `plugin-browser-state` (`read_dom`) permanently — documentation
content comes from authored Markdown, never the rendered page — and `plugin-web-search` because it
is the only default-on plugin and because a general web search contradicts the assistant's grounding
and citation policy. Both are asserted as outcomes in the unit guard above and on the built site.

## Routing into Sentry (`app-browser`)

`create-runtime.ts` builds the `PluginHost` whose `capture` forwards to the shared telemetry
sink, choosing the message path for `info`-level reports and the exception path otherwise:

```ts
capture: (report) => {
  const options = {
    level: report.level ?? 'warning',
    tags: { plugin: report.pluginId, plugin_kind: report.kind },
    contexts: report.contexts,
    fingerprint: ['plugin', report.pluginId, report.kind]
  }
  if (report.level === 'info') {
    captureTelemetryMessage(report.message, options) // → Sentry captureMessage (info message)
  } else {
    captureTelemetryException(report.message, options) // → Sentry captureException (error issue)
  }
}
```

Both `captureTelemetryMessage` and `captureTelemetryException` are **no-ops unless** the browser
has registered its `@sentry/react` sinks — which only happens after the user grants telemetry
consent and only on deployed builds (never `development`). So a feedback submission is delivered
only when **both** the plugin and telemetry are enabled; otherwise it silently no-ops while the
tool still reports "not implemented". Feedback uses `info`, so it lands as an informational message
rather than an error issue. See [sentry-telemetry.md](../architecture/sentry-telemetry.md) and [PRIVACY.md](../overview/PRIVACY.md).

## Dependency rules

- `@tinytinkerer/agent-core` still imports only `contracts` (the plugin layer adds no new edge). It
  owns the plugin _runtime_ (registry + hooks + `ToolRegistry`) and re-exports the plugin contract
  and `Tool` interface from `contracts`.
- Any `@tinytinkerer/plugin-*` package under `packages/plugins/*` may import only `contracts` and
  local modules, and must stay product-agnostic (no browser APIs, React, or telemetry imports).
  Enforced generically by `scripts/check-boundaries.mjs`.
- `@tinytinkerer/app-browser` **must not** import a concrete plugin package, statically or via a
  literal dynamic import. It knows only the `PluginModule` contract and receives a catalogue per
  `BrowserApp` from its host. The boundary check rejects any `@tinytinkerer/plugin-*` import from
  `app-browser`, and `@tinytinkerer/catalogue` — the one package permitted to name plugins — has a
  positive rule of its own allowing `plugin-*` and `contracts` only. It implements the `PluginHost`
  capabilities (the capture sink → telemetry, `requestHumanInput` → its single generic
  `<HumanPromptHost/>` modal, `edgeFetch` → its own edge layer, `executeSandboxedCode` → its
  opaque-origin iframe + Worker sandbox, and `readDom` → its current-page DOM reader with host-side
  caps + redaction) and surfaces the Settings toggles from the discovered manifests.

## Adding a new plugin

Adding a plugin touches **one list** — `packages/app/catalogue/src/index.ts`, with a test that tells
you when you have forgotten it — and no other host code. Everything a plugin
contributes is read off its manifest generically: tools (`toolDescriptors`), a heuristic planner
step (`keywordPlannerStep`), a turn-activity summary (`summarizeActivity`), a permission view
(`summarizePermission`), a persistent status gauge (`statusDescriptor`), the developer inspector
(`inspectorDescriptor`, which also arms request capture when present), and user-configurable settings
(`settingsDescriptor` — dropdowns/toggles the host renders, persists, and reads generically). The **one**
exception is the
dom-snapshot channel between `read_dom` and `run_javascript` (see above), which the host wires
explicitly via a single tool-id literal; nothing else in `create-runtime.ts` names a concrete plugin.

1. Create `packages/plugins/plugin-<name>` depending on `contracts`.
2. From its `src/index.ts`, export the `PluginModule` surface: a `manifest`
   (`{ id, label, description, toolDescriptors? }`, plus any of the optional descriptors above) and a
   `createPlugin()` returning an `AgentPlugin` (with `createTools`).
3. Add one line to `PLUGIN_LOADERS` in `packages/app/catalogue/src/index.ts` and the matching
   `workspace:*` dependency in that package's `package.json`. (Forget this and
   `catalogue-coverage.test.ts` fails with the exact line to add.)
4. Run `pnpm check:boundaries` to verify it stays product-agnostic.
5. If the plugin sends user content anywhere, document it in `PRIVACY.md` / `PRIVACY-UPDATE.md`.

That's it — every product shell carries the full catalogue, so the host shows its toggle and wires
its tools when active. No `app-browser` dependency or descriptor edits are needed. (The
documentation site carries a deliberate subset; see above.)

**The descriptor↔createTools lockstep (issue #400 review, F1):** a plugin's `toolDescriptors` MUST
enumerate every tool id its `createTools` can ever contribute. Capability gating may contribute
FEWER tools than declared at runtime (e.g. no sandbox available) — that's expected and unwarned —
but it may never contribute a tool id, or a variant of one, that isn't declared. An undeclared
contributed tool is invisible to the planner (no descriptor, so the model never sees it) AND to the
tool picker (`toolIdsByPlugin` has no entry for it, so it can never be disabled). `create-runtime.ts`
checks this after collecting contributions and reports a violation to telemetry
(`plugin-tool-undeclared` fingerprint) rather than letting it fail silently.
