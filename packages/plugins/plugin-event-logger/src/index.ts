// =============================================================================
// plugin-event-logger — a reference / copyable template for a HOOK plugin.
// =============================================================================
//
// WHAT THIS PLUGIN DOES
// ---------------------
// On every chat event emitted by the agent runtime it prints verbose, readable
// information to the browser console (the event type, the full event payload, a
// timestamp, and this plugin's id). It contributes NO tools and never changes
// runtime behavior — it only observes. It is off by default and is meant to be
// enabled from the Settings modal while debugging or while learning how the
// hook system works.
//
// Use this file as the starting point when writing your own hook plugin: copy
// the whole `packages/plugins/plugin-event-logger/` directory, rename it, and
// replace the handler body below. See "COPY THIS AS A TEMPLATE" at the bottom.
//
//
// THE HOOK SYSTEM IN ONE SCREEN
// -----------------------------
// A plugin is a small workspace package under `packages/plugins/*`. The host
// (app-browser) never imports a concrete plugin by name. Instead it discovers
// every `packages/plugins/*/src/index.ts` DYNAMICALLY at build time with a Vite
// `import.meta.glob` (see `packages/app/app-browser/src/plugins/registry.ts`).
// A discovered module is trusted only if it satisfies the `PluginModule`
// contract, i.e. it exports:
//
//     export const manifest: PluginManifest      // UI + capability metadata
//     export const createPlugin: () => AgentPlugin // factory for the runtime
//
// That is the entire discovery surface. Because discovery is automatic, this
// package needs NO edits anywhere else in the repo — adding the directory is
// enough for the host to find it and list it in the Settings modal.
//
// A plugin can contribute two kinds of hook, distinguished by the `event` field
// of each `AgentHookContribution` (see `AgentHookContribution` in
// `packages/shared/contracts/src/plugins.ts`):
//
//   1. OBSERVER hooks  — `{ event: 'chat.event', handler }`
//        Fire-and-forget reactions to runtime events. The runtime awaits the
//        handler but IGNORES its return value and SWALLOWS any error it throws
//        (see `runChatEventHooks` in agent-core). An observer can therefore
//        never block, deny, or alter execution. This plugin uses an observer.
//
//   2. GATE hooks      — `{ event: 'tool.beforeExecute', handler }`
//        Awaited guards that run before a tool executes and may BLOCK it by
//        returning `{ allow: false, reason }`. A throw or a timeout is treated
//        as a denial. Use a gate when you need to veto an operation (e.g. a
//        permission prompt); use an observer when you only need to watch.
//
// This template demonstrates the OBSERVER variety. Because it only watches, it
// needs no input schema (no zod dependency) and cannot affect a chat run.
//
//
// THE MANIFEST / CAPABILITIES / createHooks CONTRACT
// --------------------------------------------------
//   • `PluginManifest` is host-facing metadata. Its `label` and `description`
//     are shown verbatim in the Settings modal, so write them for an end user.
//     `capabilities` advertises what the plugin contributes: `['hooks']` here
//     (a tool plugin would use `['tools']` and add `toolDescriptors`). We set
//     NO `toolDescriptors` because we ship no tools.
//   • `createPlugin()` returns an `AgentPlugin`. A hook plugin implements
//     `createHooks(host)` and returns its `AgentHookContribution[]`. (A tool
//     plugin would implement `createTools(host)` instead/as well.) `host`
//     exposes host services such as the telemetry `capture` sink; this plugin
//     does not need it.
//   • The plugin's `id` MUST equal the manifest `id` — the host uses it as the
//     activation key (which plugins the user toggled on) and as a capture tag.
//
// Keep this file dependency-light and host-agnostic: import only from
// `@tinytinkerer/contracts` (the plugin contract + the event shape). Never reach
// into a concrete runtime or a browser-only global beyond the standard `console`.
// =============================================================================

import type {
  AgentHookContribution,
  AgentPlugin,
  ChatEvent,
  ChatEventHookContext,
  PluginManifest,
  PluginModule
} from '@tinytinkerer/contracts'

// Stable id used as the activation key (which plugins the user enabled) and as
// the manifest id surfaced in the Settings modal. Keep it short and kebab-case.
export const EVENT_LOGGER_PLUGIN_ID = 'event-logger'

// Host-facing metadata. `label` + `description` render verbatim in the Settings
// modal, so they are written for an end user. `capabilities: ['hooks']` advertises
// that this plugin contributes hooks and no tools (hence no `toolDescriptors`).
export const eventLoggerPluginManifest: PluginManifest = {
  id: EVENT_LOGGER_PLUGIN_ID,
  label: 'Event Logger (developer console)',
  description:
    'Developer/debug aid: logs every chat event to the browser console with its ' +
    'type, full payload, and a timestamp. Contributes no tools and never changes ' +
    'how the assistant behaves — it only observes. Handy for understanding the ' +
    'agent runtime or building your own plugin. Open the browser devtools console ' +
    'to see the output. Off by default.',
  capabilities: ['hooks']
}

// Build the one-line summary printed for each event. Kept pure so the test can
// assert on it without touching the console.
const summarizeEvent = (event: ChatEvent): string =>
  `[${EVENT_LOGGER_PLUGIN_ID}] chat.event → ${event.type}`

// The observer handler. Receives `{ event }` for EVERY runtime event (see the
// `chatEventSchema` union in `@tinytinkerer/contracts`: user.message,
// agent.run.*, agent.step.*, agent.tool.*, rate.limit.*, reasoning.*,
// assistant.*, error, system). It prints verbose, grouped output and returns
// void — an observer's return value is ignored and a throw is swallowed by the
// runtime, so this can never disrupt a chat.
//
// We group the noisy detail under a collapsed group so the console stays
// scannable: the group title carries the event type, and the body carries the
// full payload, the event's own timestamp, the wall-clock time we observed it,
// and the source plugin id.
const logChatEvent = ({ event }: ChatEventHookContext): void => {
  // `console.info` shows even when the console is filtered to "info" and above,
  // making the one-line summary a reliable breadcrumb.
  console.info(summarizeEvent(event))

  // The verbose detail goes into a collapsed group so it is available on demand
  // without flooding the console. `groupCollapsed`/`groupEnd` are part of the
  // standard Console API and degrade gracefully if absent.
  //
  // NOTE: we use `console.log` (not `console.debug`) for the detail lines. In
  // Chrome/Edge devtools `console.debug` maps to the "Verbose" log level, which
  // is HIDDEN unless the user explicitly enables it in the level filter — so the
  // group bodies would appear empty by default. `console.log` is visible out of
  // the box, which is what a developer expects from a logger plugin.
  console.groupCollapsed(`${summarizeEvent(event)} (details)`)
  console.log('plugin', EVENT_LOGGER_PLUGIN_ID)
  console.log('type', event.type)
  console.log('id', event.id)
  console.log('event timestamp', event.timestamp)
  console.log('observed at', new Date().toISOString())
  console.log('payload', event.payload)
  // Also log the whole event as one object so devtools renders an expandable,
  // copyable tree of every field at once.
  console.log('event', event)
  console.groupEnd()
}

// The plugin factory. A hook plugin implements `createHooks` and returns its
// contributions. Here: a single observer bound to `chat.event`. `host` (the
// PluginHost with the telemetry capture sink) is available but unused — an
// observer that only logs needs no host services.
export const eventLoggerPlugin = (): AgentPlugin => ({
  id: EVENT_LOGGER_PLUGIN_ID,
  createHooks: (): AgentHookContribution[] => [
    {
      event: 'chat.event',
      handler: logChatEvent
    }
  ]
})

// PluginModule contract surface: the named exports the host discovers
// dynamically via the `import.meta.glob`. `manifest` and `createPlugin` are the
// only members the host relies on, so it never needs to know this package by name.
export const manifest: PluginManifest = eventLoggerPluginManifest
export const createPlugin: PluginModule['createPlugin'] = eventLoggerPlugin

// =============================================================================
// COPY THIS AS A TEMPLATE
// =============================================================================
// To create a new hook plugin:
//
//   1. Copy this directory to `packages/plugins/plugin-<your-name>/`.
//   2. In package.json, rename `@tinytinkerer/plugin-event-logger` to
//      `@tinytinkerer/plugin-<your-name>` (keep `private`, `type: module`, the
//      same `exports`/`scripts`, and the contracts dep). If your
//      hook validates input you may add `zod`; an observer like this needs none.
//   3. Change `EVENT_LOGGER_PLUGIN_ID`, the manifest `label`/`description`, and
//      the handler body. Keep the plugin `id` equal to the manifest `id`.
//   4. For a GATE instead of an observer, return a `tool.beforeExecute`
//      contribution whose handler resolves to `{ allow: true }` or
//      `{ allow: false, reason }`. For a TOOL plugin, set `capabilities: ['tools']`,
//      add `toolDescriptors`, and implement `createTools` (see plugin-feedback).
//   5. Keep `export const manifest` and `export const createPlugin` — they are
//      the discovery surface. No host edits are needed: the glob picks it up and
//      it appears (off by default) in the Settings modal automatically.
// =============================================================================
