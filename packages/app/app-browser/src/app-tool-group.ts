import type { Tool } from '@tinytinkerer/app-core'

// A named group of an app's always-on tools (issue #400 follow-up). An app (e.g.
// the canvas shell) contributes its verbs as ONE group with a stable `id` and a
// user-facing `label`; the group is registered in the runtime, surfaced in the
// tool picker beside plugin groups, and its per-tool disablement is keyed by `id`
// in appToolDisablement. Unlike a plugin, an app has no activation toggle — the
// group is always shown (Excalidraw is intrinsic to the canvas), even with every
// tool unchecked.
//
// Lives in its own module (rather than app.ts) so the chat store and runtime can
// import it without a cycle through app.ts, which imports them.
export type AppToolGroup = {
  id: string
  label: string
  tools: Tool<unknown, unknown>[]
}
