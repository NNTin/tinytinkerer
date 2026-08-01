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
  /**
   * The group's stable catalogue: what the tool picker lists and what per-tool
   * disablement is keyed against. Ids and descriptions here never change within
   * a session.
   */
  tools: Tool<unknown, unknown>[]
  /**
   * Optional per-RUN tool instances (issue #480 review, finding 5).
   *
   * `createRuntime` is called once per run, so a group whose behaviour depends on
   * state captured at the moment the reader hit send builds its tools here
   * instead of once per session. The documentation assistant uses it to pin
   * "the current page" to the run: `read_current_doc` executes long after the
   * prompt was submitted, and without a pin a reader who navigates while the
   * model is still deciding gets an answer about the page they moved to.
   *
   * Must return the same tool ids as `tools` — the picker, the disablement
   * denylist and the runtime all key on those, and the runtime filters these
   * instances through the selection made against the catalogue above. Omitted
   * (the default) and the runtime registers `tools` directly, which is what every
   * existing app group does.
   */
  createTools?: () => Tool<unknown, unknown>[]
}
