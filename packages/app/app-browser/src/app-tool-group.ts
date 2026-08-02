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

export type AppTool = Tool<unknown, unknown>

/**
 * A per-run implementation for ONE tool already in the group's catalogue.
 *
 * Deliberately carries nothing but the body. A run may need context the
 * catalogue cannot have — the documentation assistant pins "which page was the
 * reader on when they hit send?" — but it must never restate the tool's
 * identity, description, schemas or summarizer, because those are what the
 * reader saw in the picker and what the model is handed.
 */
export type AppToolRunImplementation = Pick<AppTool, 'execute'>

/**
 * Per-run implementations, keyed by the id of the catalogue tool each replaces.
 *
 * Partial by design: a group binds only the tools that actually capture run
 * context, and every other tool is served from the catalogue unchanged.
 */
export type AppToolRunBindings = Readonly<Record<string, AppToolRunImplementation>>

export type AppToolGroup = {
  id: string
  label: string
  /**
   * The group's tools, and the ONLY place their metadata is written (issue #480
   * re-review, finding 1). This array is what the picker lists, what per-tool
   * disablement is keyed against, where activity summarizers are resolved from,
   * and — after {@link bindRun} has swapped in any run-scoped bodies — what the
   * runtime registers.
   */
  tools: AppTool[]
  /**
   * Optional per-run rebinding, for a group whose tools must act on state as of
   * the moment a run STARTS rather than the moment they execute.
   *
   * `createRuntime` calls this once per run and applies the result over the
   * catalogue by tool id. It can supply a different body; it cannot add a tool,
   * remove one, or change any tool's metadata, because it never touches the
   * catalogue array — which is what makes the drift this API used to allow
   * structurally impossible rather than merely validated.
   *
   * The documentation assistant is the motivating case: `read_current_doc`
   * executes long after the prompt was submitted, and a reader who navigates
   * meanwhile meant the page they asked about, so its run body closes over the
   * route captured here.
   */
  bindRun?: () => AppToolRunBindings
}

// Groups whose ids have already been checked. The check is cheap, but the
// catalogue is read on every tool-picker render, and a group object outlives the
// session.
const validated = new WeakSet<AppToolGroup>()

const assertUniqueIds = (group: AppToolGroup): void => {
  const ids = new Set<string>()
  for (const tool of group.tools) {
    if (ids.has(tool.id)) {
      throw new Error(
        `App tool group "${group.id}" contains more than one tool with id "${tool.id}". ` +
          'Tool ids key the picker, per-tool disablement and runtime registration, so they must be unique.'
      )
    }
    ids.add(tool.id)
  }
}

/**
 * The group's catalogue: what the tool picker lists, what per-tool disablement is
 * keyed against, and where activity summarizers are resolved from.
 *
 * Returns the group's own array, so its identity is stable for the lifetime of
 * the group object — the picker reads it inside a `useMemo` keyed on the group.
 */
export const appToolCatalogue = (group: AppToolGroup): AppTool[] => {
  if (!validated.has(group)) {
    assertUniqueIds(group)
    validated.add(group)
  }
  return group.tools
}

/**
 * The instances to register for ONE run.
 *
 * The catalogue itself for a group with no run bindings — the same instances the
 * picker lists, which is what every stateless group wants. Otherwise the
 * catalogue with each bound tool's `execute` replaced, and nothing else changed.
 *
 * Throws when a binding names a tool the catalogue does not contain. A binding
 * that misses its target is silent otherwise: the reader's selection would be
 * applied to a catalogue tool still carrying the context-free body, which is
 * exactly the class of failure this seam exists to prevent.
 */
export const createAppToolRunInstances = (group: AppToolGroup): AppTool[] => {
  const catalogue = appToolCatalogue(group)
  if (!group.bindRun) return catalogue

  const bindings = group.bindRun()
  const ids = new Set(catalogue.map((tool) => tool.id))
  const unknown = Object.keys(bindings)
    .filter((id) => !ids.has(id))
    .sort()
  if (unknown.length > 0) {
    throw new Error(
      `App tool group "${group.id}" bound per-run implementations for tools it does not declare: ` +
        `${unknown.join(', ')}. A run binding may only replace the body of a tool already in the group's catalogue.`
    )
  }

  return catalogue.map((tool) => {
    const bound = bindings[tool.id]
    return bound ? { ...tool, execute: bound.execute } : tool
  })
}
