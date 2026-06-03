# Plugin Infrastructure

TinyTinkerer supports optional **plugins** that contribute tools to the agent runtime. Plugins
register at `@tinytinkerer/agent-core` (the product-agnostic runtime layer), are activated and
deactivated per-user in the Settings Modal, and are gated by that activation state when a chat
run builds its runtime.

The first plugin is the **Feedback** plugin (`send_feedback`). It has no backend: submitted
feedback is routed into Sentry telemetry instead of a real service.

See also:
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [packages-concept.md](./packages-concept.md)
- [sentry-telemetry.md](./sentry-telemetry.md)
- [mcp-integration.md](./mcp-integration.md) — the closest existing pattern (settings-gated tools)
- [PRIVACY.md](./PRIVACY.md) — feedback content is sent via telemetry on purpose

---

## The plugin contract (`agent-core`)

`packages/app/agent-core/src/plugins/` owns the product-agnostic contract. It imports only
`contracts`, so it carries no browser, telemetry, or app dependency.

```ts
interface AgentPlugin {
  id: string
  createTools?(host: PluginHost): Tool<unknown, unknown>[]
  activate?(host: PluginHost): void | Promise<void>
  deactivate?(): void | Promise<void>
}

interface PluginHost {
  capture: PluginCaptureSink   // injected by the host; forwards reports out-of-band
}

type PluginCaptureSink = (report: PluginReport) => void

type PluginReport = {
  pluginId: string
  kind: string
  message: string
  level?: 'warning' | 'error'
  contexts?: Record<string, Record<string, unknown>>
}

class PluginCaptureError extends Error {
  readonly report: PluginReport   // routed to host.capture by the registry
}
```

`PluginHost.capture` is an **inversion-of-control sink**, exactly like the telemetry
`setCaptureExceptionSink` in `@tinytinkerer/sentry-telemetry`: `agent-core` defines the *type*,
and the host (the browser) supplies the implementation that forwards to Sentry.

## The registry & activation gating (`agent-core`)

`PluginRegistry` collects tools for the **active** plugins only:

```ts
registry.collectTools(activeIds: ReadonlySet<string>, host: PluginHost): Tool[]
```

- A plugin whose id is not in `activeIds` contributes nothing.
- A newly-active plugin gets a one-time `activate(host)` call; failures are swallowed so a
  misbehaving plugin can never break a chat run.
- Each contributed tool's `execute` is wrapped so that a thrown `PluginCaptureError` forwards
  its `report` to `host.capture` and is then **rethrown** — the agent runtime's normal
  tool-failure path (`agent.tool.failed`) still runs.

## The Feedback plugin (`@tinytinkerer/plugin-feedback`)

A dedicated package at `packages/plugins/plugin-feedback`, depending only on `agent-core` and
`contracts`. It exports `feedbackPlugin()`, `FeedbackPendingError`, `feedbackPluginManifest`
(UI copy for the Settings toggle), and `SEND_FEEDBACK_PLUGIN_ID`.

Its single `send_feedback` tool takes `{ message, category? }` (validated by
`feedbackInputSchema` from `contracts`) and **throws** a typed `FeedbackPendingError`:

```
send_feedback (throws FeedbackPendingError)
        │  carries PluginReport { kind: 'feedback', message, contexts }
        ▼
PluginRegistry tool wrapper  ──catches PluginCaptureError──▶ host.capture(report)  ──▶ Sentry
        │ rethrows
        ▼
AgentRuntimeBase.runToolCall  ──▶ agent.tool.failed ("send_feedback: not implemented")
```

So feedback is **captured** (to telemetry) and then surfaced as a graceful tool failure. There
is intentionally no backend.

## Activation state flow

Activation is stored and orchestrated headlessly, then surfaced in the browser:

```
Settings Modal toggle (app-browser/browser-settings-modal.tsx)
  → settings store action setPluginEnabled (app-browser/stores/settings-store.ts)
  → persistPluginActivation (app-core/settings.ts) → PreferencesStore (IndexedDB)
  ──────────────────────────────────────────────────────────────────────────────
  next chat run:
  get-runtime reads settings.pluginActivation
  → create-runtime: resolveActivePluginIds() + PluginRegistry.collectTools()
  → agent-core ToolRegistry  (only active plugins' tools)
```

- **State shape:** `PluginActivationState = Record<pluginId, boolean>` in `contracts`.
- **Default:** `{}` — every plugin is **off by default** (opt-in, like MCP servers and
  telemetry).
- **Persistence key:** `settings_plugins_activation`.
- **Planner exposure:** active plugin tools are also added to the planner tool descriptors in
  `create-runtime.ts`, so the model can name and invoke them (e.g. `send_feedback`).

## Routing into Sentry (`app-browser`)

`create-runtime.ts` builds the `PluginHost` whose `capture` forwards to the shared telemetry
sink:

```ts
capture: (report) => captureTelemetryException(report.message, {
  level: report.level ?? 'warning',
  tags: { plugin: report.pluginId, plugin_kind: report.kind },
  contexts: report.contexts,
  fingerprint: ['plugin', report.pluginId, report.kind]
})
```

`captureTelemetryException` is a **no-op unless** the browser has registered its `@sentry/react`
sink — which only happens after the user grants telemetry consent and only on deployed builds
(never `development`). So a feedback submission is delivered only when **both** the plugin and
telemetry are enabled; otherwise it silently no-ops while the tool still reports
"not implemented". See [sentry-telemetry.md](./sentry-telemetry.md) and [PRIVACY.md](./PRIVACY.md).

## Dependency rules

- `@tinytinkerer/agent-core` still imports only `contracts` (the plugin layer adds no new edge).
- `@tinytinkerer/plugin-feedback` may import only `agent-core`, `contracts`, and local modules,
  and must stay product-agnostic (no browser APIs, React, or telemetry imports). Enforced by
  `scripts/check-boundaries.mjs`.
- `@tinytinkerer/app-browser` may additionally depend on `plugin-feedback` (and future plugin
  packages); it wires the capture sink to telemetry and surfaces the Settings toggle.

## Adding a new plugin

1. Create `packages/plugins/plugin-<name>` depending on `agent-core` + `contracts`.
2. Export an `AgentPlugin` (with `createTools`) and a `pluginManifest` (`{ id, label, description }`).
3. Add the package to `app-browser` deps, register it in `create-runtime.ts`'s `browserPlugins`,
   add its planner descriptors, and add its manifest to `AVAILABLE_PLUGINS` in `surfaces.tsx`.
4. Add the boundary rules for the new package in `scripts/check-boundaries.mjs`.
5. If the plugin sends user content anywhere, document it in `PRIVACY.md` / `PRIVACY-UPDATE.md`.
