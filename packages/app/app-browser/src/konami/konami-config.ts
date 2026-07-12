// The Konami cheat code (issue #399): typing ↑ ↑ ↓ ↓ ← → ← → B A anywhere in the
// app applies a preset of settings and plays a purely-presentational easter-egg
// animation. This file is deliberately the SINGLE source of truth for both the
// sequence and the preset it applies — the issue asks for them to live together
// so a future edit (add a step, add a setting) touches one file.
//
// LISTENER SCOPE: the recognizer is wired up once, at the shell chrome level
// (konami-cheat-code.tsx, mounted by BrowserAppShell's mountGlobals block), via a
// plain `window` keydown listener. It deliberately does NOT reach into the canvas
// app's embedded Excalidraw iframe (apps/canvas/src/canvas-page.tsx): keydown
// events dispatched inside an iframe's own document never bubble to the parent
// window, so keystrokes typed while focus is inside the Excalidraw canvas simply
// don't reach this listener. That's accepted, not worked around — the cheat code
// is a chrome-level easter egg, not a canvas-content feature, and reaching into
// the iframe would mean either postMessage plumbing or relaxing the iframe
// sandbox, neither of which is worth it for a presentational Easter egg.
//
// PLUGIN IDS ARE STRING LITERALS ON PURPOSE: app-browser has no static
// dependency on any concrete plugin package — plugins are discovered at build
// time via Vite's `import.meta.glob` (see src/plugins/registry.ts), so importing
// a plugin package's id constant here would reintroduce exactly the coupling
// that discovery exists to avoid. There is precedent for the host hard-coding a
// plugin id as a string: see packages/plugins/plugin-context-inspector/src/plugin-id.ts,
// which notes the host already hard-codes ids like 'context-inspector' and
// 'web-search' to make routing decisions. If a plugin is renamed/removed, this
// list simply becomes a harmless no-op enable for a nonexistent plugin id
// (setPluginEnabled just writes an activation-map entry; nothing reads a stale
// entry for a plugin that isn't loaded).
export type KonamiPresetEntry =
  | {
      kind: 'core'
      setting: 'showReasoningActivity' | 'webSpeechEnabled' | 'telemetryEnabled'
      value: boolean
    }
  | { kind: 'plugin'; pluginId: string; enabled: boolean }

// KeyboardEvent.key values, in order. Single-character entries are lowercase
// because the recognizer (sequence-recognizer.ts) lowercases incoming
// single-character keys before comparing, so 'B'/'A' match regardless of shift
// state/caps lock.
export const KONAMI_SEQUENCE: readonly string[] = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a'
]

// Every entry enables its target — there is no "off" branch in this preset.
export const KONAMI_PRESET: readonly KonamiPresetEntry[] = [
  { kind: 'core', setting: 'showReasoningActivity', value: true },
  { kind: 'core', setting: 'webSpeechEnabled', value: true },
  { kind: 'core', setting: 'telemetryEnabled', value: true },
  { kind: 'plugin', pluginId: 'choice-prompt', enabled: true },
  { kind: 'plugin', pluginId: 'code-exec', enabled: true },
  { kind: 'plugin', pluginId: 'context-inspector', enabled: true },
  { kind: 'plugin', pluginId: 'context-usage', enabled: true },
  { kind: 'plugin', pluginId: 'event-logger', enabled: true },
  { kind: 'plugin', pluginId: 'tool-tree', enabled: true },
  { kind: 'plugin', pluginId: 'web-search', enabled: true }
]
