# Plugin Infrastructure

TinyTinkerer supports optional **plugins** that contribute tools to the agent runtime. A plugin
implements the product-agnostic contract from `@tinytinkerer/agent-core`, lives as its own
package under `packages/plugins/*`, and is **discovered dynamically** by the host — the host
never imports a concrete plugin by name. Plugins are activated/deactivated per-user in the
Settings Modal and gated by that activation state when a chat run builds its runtime.

The first plugin is the **Feedback** plugin (`send_feedback`). It has no backend: submitted
feedback is routed into Sentry telemetry instead of a real service.

> **Decoupling:** `app-browser` has **no static dependency** on any concrete plugin — not in its
> `package.json`, not as an import. It depends only on the `PluginModule` contract in
> `agent-core`. A plugin package can be added or removed from `packages/plugins/*` and the project
> still type-checks and builds; the plugin's tools simply appear or disappear. See
> [Dynamic discovery](#dynamic-discovery-app-browser).

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

// Host-agnostic discovery contract. A plugin package's entry module exports a
// `manifest` and a `createPlugin` factory; the host loads it dynamically and
// validates it with `isPluginModule` before trusting it.
type PluginToolDescriptor = { id: string; description: string; inputSchema: Record<string, unknown> }

type PluginManifest = {
  id: string
  label: string                       // Settings toggle copy
  description: string
  toolDescriptors?: PluginToolDescriptor[]   // planner descriptors for the plugin's tools
}

type PluginModule = {
  manifest: PluginManifest
  createPlugin: () => AgentPlugin
}

function isPluginModule(value: unknown): value is PluginModule  // runtime guard
```

`PluginManifest`/`PluginModule` live in the **contract layer**, not inside any concrete plugin,
so the host depends only on the abstraction. `isPluginModule` keeps dynamic loading best-effort:
an absent or malformed module is rejected here rather than throwing into host construction.

`PluginHost.capture` is an **inversion-of-control sink**, exactly like the telemetry
`setCaptureExceptionSink` in `@tinytinkerer/sentry-telemetry`: `agent-core` defines the *type*,
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
  break runtime construction. A plugin's `createTools` that throws is caught and contributes no
  tools.
- Each contributed tool's `execute` is wrapped so that a thrown `PluginCaptureError` forwards
  its `report` to `host.capture` and is then **rethrown** — the agent runtime's normal
  tool-failure path (`agent.tool.failed`) still runs. The capture call is itself best-effort, so
  a throwing sink never changes the error the runtime observes.

## The Feedback plugin (`@tinytinkerer/plugin-feedback`)

A dedicated package at `packages/plugins/plugin-feedback`, depending only on `agent-core` and
`contracts`. To be discoverable it exports the `PluginModule` surface — `manifest` (a
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
  chat-store: loadPluginModules()  (dynamic discovery, see below)
  → get-runtime reads settings.pluginActivation, forwards the loaded modules
  → create-runtime: resolveActivePluginIds() filters modules → PluginRegistry.collectTools()
  → agent-core ToolRegistry  (only active plugins' tools)
```

- **State shape:** `PluginActivationState = Record<pluginId, boolean>` in `contracts`.
- **Default:** `{}` — every plugin is **off by default** (opt-in, like MCP servers and
  telemetry).
- **Persistence key:** `settings_plugins_activation`.
- **Planner exposure:** for each active plugin, `create-runtime.ts` adds its
  `manifest.toolDescriptors` to the planner tool descriptors, so the model can name and invoke
  them (e.g. `send_feedback`). Descriptors travel with the plugin — the host hard-codes none.

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
      if (isPluginModule(mod)) modules.push(mod)   // tolerate-missing / tolerate-malformed
    } catch { /* optional plugin failed to load — skip */ }
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
  `import('<bare specifier>')` would force the package to exist at build; a *variable* bare
  specifier would not bundle at all. The glob is the only mechanism that satisfies both.
- **True drop-in.** Any package placed under `packages/plugins/*` that exports a valid
  `PluginModule` is discovered automatically. Nothing about a specific plugin is hard-coded in
  `app-browser`.

`loadPluginModules()` is consumed in two places, both via the loaded `PluginModule[]`:
`chat-store` awaits it and passes the modules to `createBrowserRuntimeFactory` (runtime tools +
descriptors), and the Settings controller (`surfaces.tsx`) loads the manifests for the toggles.

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
- `@tinytinkerer/plugin-feedback` (and any `packages/plugins/*` package) may import only
  `agent-core`, `contracts`, and local modules, and must stay product-agnostic (no browser APIs,
  React, or telemetry imports). Enforced by `scripts/check-boundaries.mjs`.
- `@tinytinkerer/app-browser` **must not** import a concrete plugin package, statically or via a
  literal dynamic import — plugins are discovered through `import.meta.glob`. The boundary check
  rejects any `@tinytinkerer/plugin-*` import from `app-browser`. It wires the capture sink to
  telemetry and surfaces the Settings toggles from the discovered manifests.

## Adding a new plugin

Because discovery is dynamic, adding a plugin touches **no host code**:

1. Create `packages/plugins/plugin-<name>` depending on `agent-core` + `contracts`.
2. From its `src/index.ts`, export the `PluginModule` surface: a `manifest`
   (`{ id, label, description, toolDescriptors? }`) and a `createPlugin()` returning an
   `AgentPlugin` (with `createTools`).
3. Add the boundary rules for the new package in `scripts/check-boundaries.mjs`.
4. If the plugin sends user content anywhere, document it in `PRIVACY.md` / `PRIVACY-UPDATE.md`.

That's it — the host discovers it via `import.meta.glob`, shows its toggle, and wires its tools
when active. No `app-browser` dependency, registration, or descriptor edits are needed.
