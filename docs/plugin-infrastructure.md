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

The repo currently ships seven plugins under `packages/plugins/*`: **Feedback**
(`send_feedback`), **Event logger** (a `chat.event` observer hook), **Permissions** (a
`tool.beforeExecute` gate), **Web search** (the Tavily `web-search` tool), **Code execution**
(the `run_javascript` sandbox tool), **Browser state** (the `read_dom` page-reading tool), and
**Choice prompt** (the `ask_user` human-in-the-loop tool). A plugin contributes tools and/or hooks,
and may use a host-injected capability (telemetry capture, a **human-in-the-loop prompt** — the one
surface behind both the permissions gate and the choice poll — an edge request, a code sandbox, or a
DOM read) without importing the host.

> **Decoupling:** `app-browser` has **no static dependency** on any concrete plugin — not in its
> `package.json`, not as an import. It depends only on the `PluginModule` contract in
> `contracts`. A plugin package can be added or removed from `packages/plugins/*` and the project
> still type-checks and builds; the plugin's tools simply appear or disappear. See
> [Dynamic discovery](#dynamic-discovery-app-browser).

See also:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [packages-concept.md](./packages-concept.md)
- [sentry-telemetry.md](./sentry-telemetry.md)
- [mcp-integration.md](./mcp-integration.md) — the closest existing pattern (settings-gated tools)
- [PRIVACY.md](./PRIVACY.md) — feedback content is sent via telemetry on purpose

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
type ActivityView = {
  title: string // collapsed-summary heading
  status?: 'ok' | 'error' | 'warn' // drives the row's status styling
  sections: { label: string; value: string }[] // label/value rows shown on expand
}
type ActivitySummarizer = (output: unknown) => ActivityView

type PluginToolDescriptor = {
  id: string
  description: string
  inputSchema: Record<string, unknown>
  summarizeActivity?: ActivitySummarizer // owns this tool's turn-activity presentation
}

type PluginManifest = {
  id: string
  label: string // Settings toggle copy
  description: string
  toolDescriptors?: PluginToolDescriptor[] // planner descriptors for the plugin's tools
  defaultEnabled?: boolean // ships on out-of-the-box when true (e.g. web search)
}

type PluginModule = {
  manifest: PluginManifest
  createPlugin: () => AgentPlugin
}

function isPluginModule(value: unknown): value is PluginModule // runtime guard
```

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
app-browser requestHumanInput  → enqueues the view on the shared human-prompt store → <HumanPromptHost/> resolves it
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
(`chat-store.ts` → `resetAllHumanPrompts`), so a prompt never outlives its run. Only a poll the host
never answers within the human-input budget surfaces as a tool failure.

**One generic human-prompt surface — no per-feature host code.** The Permissions allow/deny prompt and
the Choice poll are the same machinery, so the host owns exactly **one** of everything: one capability
(`requestHumanInput`), one module-level store of pending `HumanPromptView`s (`human-prompt-bridge.ts`),
and one generic modal (`<HumanPromptHost/>`) mounted **once** in the browser shell root
(`create-browser-shell-root.tsx`) — never named per-shell. A plugin owns its prompt entirely: it builds
the `HumanPromptView` (title, `actions`, `allowCustom`, a `dismissAction`) and maps the generic
`HumanPromptResult` back to its own outcome — the permissions gate to a `ToolGateResult`, the choice tool
to a `ChoicePromptResult`. The **one** cross-plugin concern only the host can do stays host-side and
generic: a view's optional `inputContext: { toolId, input }` is rendered via the **gated tool owner's**
`summarizePermission` (resolved by tool id across all manifests, falling back to a JSON dump) — so the
permission body still travels with the tool it describes, not with the permissions plugin. The chat-store
settles every open prompt via `resetAllHumanPrompts()` on abort/reset, so the run lifecycle names no
feature and a future HITL surface needs no new service, component, or shell mount — just the `HumanPromptView`.

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
  chat-store: loadPluginModules()  (dynamic discovery, see below)
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
  `PluginToolDescriptor.summarizeActivity` — a pure, React-free `(output) => ActivityView` mapper
  keyed by tool id. The host's turn-activity panel (`turn-activity-panel.tsx`) carries **zero**
  per-tool branches: it builds a `Map<toolId, ActivitySummarizer>` from the discovered manifests
  (`surfaces.tsx`), resolves one per completed tool, and feeds the result to a single generic
  renderer (`title` + status styling collapsed, `sections` as label/value rows on expand).
  Summarizers should set `status` when the outcome is known; omitted status renders as the
  neutral `unknown` cue, not as success. Tools without a summarizer get a neutral default:
  title = tool label; `(no output)` only when output is genuinely empty; otherwise the host shows
  bounded raw JSON output. That fallback is for debuggability, not curation — plugin authors should
  ship `summarizeActivity` for sensitive or verbose outputs. MCP tools are summarized by the MCP
  tool layer (`runtime/mcp-tool.ts`, `summarizeMcpActivity` keyed by the `mcp:*` id pattern), not
  the panel. Output is untrusted: the host renders every `ActivityView` value as text, never HTML.

## Dynamic discovery (`app-browser`)

`app-browser/src/plugins/registry.ts` is the **only** module aware of where plugins live, and it
references them by location, not by package name:

```ts
const pluginModuleLoaders = import.meta.glob<unknown>('../../../../plugins/*/src/index.ts')

export const loadPluginModules = async (): Promise<PluginModule[]> => {
  const modules: PluginModule[] = []
  for (const load of Object.values(pluginModuleLoaders)) {
    try {
      const mod = await load()
      if (isPluginModule(mod)) modules.push(mod) // tolerate-missing / tolerate-malformed
    } catch {
      /* optional plugin failed to load — skip */
    }
  }
  return modules
}
```

Why `import.meta.glob` rather than a static or literal dynamic `import('@tinytinkerer/plugin-…')`:

- **Compiles if missing.** Glob patterns are not module specifiers, so `tsc` never resolves a
  concrete plugin. Delete `packages/plugins/plugin-feedback` and `pnpm typecheck` + the Vite
  builds still succeed — the glob simply matches nothing. (Verified by removing the package.)
- **Bundles when present.** Vite resolves the glob at build time and emits each matched plugin as
  its own lazy chunk, so the feature works in the production browser bundle. A literal
  `import('<bare specifier>')` would force the package to exist at build; a _variable_ bare
  specifier would not bundle at all. The glob is the only mechanism that satisfies both.
- **True drop-in.** Any package placed under `packages/plugins/*` that exports a valid
  `PluginModule` is discovered automatically. Nothing about a specific plugin is hard-coded in
  `app-browser`.

`loadPluginModules()` is consumed in two places, both via the loaded `PluginModule[]`:
`chat-store` awaits it once and passes the modules to `createBrowserRuntimeFactory` (runtime tools

- descriptors, with lifecycle preserved across prompts), and the Settings controller
  (`surfaces.tsx`) loads the manifests for the toggles.

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
rather than an error issue. See [sentry-telemetry.md](./sentry-telemetry.md) and [PRIVACY.md](./PRIVACY.md).

## Dependency rules

- `@tinytinkerer/agent-core` still imports only `contracts` (the plugin layer adds no new edge). It
  owns the plugin _runtime_ (registry + hooks + `ToolRegistry`) and re-exports the plugin contract
  and `Tool` interface from `contracts`.
- Any `@tinytinkerer/plugin-*` package under `packages/plugins/*` may import only `contracts` and
  local modules, and must stay product-agnostic (no browser APIs, React, or telemetry imports).
  Enforced generically by `scripts/check-boundaries.mjs`.
- `@tinytinkerer/app-browser` **must not** import a concrete plugin package, statically or via a
  literal dynamic import — plugins are discovered through `import.meta.glob`. The boundary check
  rejects any `@tinytinkerer/plugin-*` import from `app-browser`. It implements the `PluginHost`
  capabilities (the capture sink → telemetry, `requestHumanInput` → its single generic
  `<HumanPromptHost/>` modal, `edgeFetch` → its own edge layer, `executeSandboxedCode` → its
  opaque-origin iframe + Worker sandbox, and `readDom` → its current-page DOM reader with host-side
  caps + redaction) and surfaces the Settings toggles from the discovered manifests.

## Adding a new plugin

Because discovery is dynamic, adding a plugin touches **no host code** — everything a plugin
contributes is read off its manifest generically: tools (`toolDescriptors`), a heuristic planner
step (`keywordPlannerStep`), a turn-activity summary (`summarizeActivity`), a permission view
(`summarizePermission`), a persistent status gauge (`statusDescriptor`), and the developer inspector
(`inspectorDescriptor`, which also arms request capture when present). The **one** exception is the
dom-snapshot channel between `read_dom` and `run_javascript` (see above), which the host wires
explicitly via a single tool-id literal; nothing else in `create-runtime.ts` names a concrete plugin.

1. Create `packages/plugins/plugin-<name>` depending on `contracts`.
2. From its `src/index.ts`, export the `PluginModule` surface: a `manifest`
   (`{ id, label, description, toolDescriptors? }`, plus any of the optional descriptors above) and a
   `createPlugin()` returning an `AgentPlugin` (with `createTools`).
3. Run `pnpm check:boundaries` to verify it stays product-agnostic.
4. If the plugin sends user content anywhere, document it in `PRIVACY.md` / `PRIVACY-UPDATE.md`.

That's it — the host discovers it via `import.meta.glob`, shows its toggle, and wires its tools
when active. No `app-browser` dependency, registration, or descriptor edits are needed.
