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
 * Why the factory is being called.
 *
 * `'catalogue'` builds the list the tool picker shows, once per group; `'run'`
 * builds the instances one run registers. A factory that captures nothing can
 * ignore it — but one that captures "what was true when the reader hit send"
 * must NOT capture it for the catalogue, which is derived whenever the picker
 * first renders and is never executed.
 */
export type AppToolPurpose = 'catalogue' | 'run'

/**
 * Builds the group's tools. Called once to derive the catalogue the picker lists,
 * and once per RUN to produce the instances the runtime registers — from the SAME
 * definition site, which is the whole point (issue #480 re-review, finding 5).
 */
export type AppToolFactory = (purpose: AppToolPurpose) => AppTool[]

export type AppToolGroup = {
  id: string
  label: string
  /**
   * The group's tools.
   *
   * An ARRAY for a stateless group: the same instances serve the picker and every
   * run, which is what the canvas, Mermaid and IDE shells pass.
   *
   * A FACTORY for a group whose tools must capture state as of the moment a run
   * starts. `createRuntime` runs once per run, so the factory is called there too;
   * the documentation assistant uses it to pin "which page is this?" to the run,
   * since `read_current_doc` executes long after the prompt was submitted and a
   * reader who navigates meanwhile meant the page they asked about.
   *
   * A factory is deliberately ONE field rather than a catalogue array plus a
   * separate per-run builder. Two lists have to be kept in lockstep by hand, and
   * nothing notices when an id, a schema or a description drifts between what the
   * reader selects in the picker and what the model is handed. With one definition
   * site that drift is not expressible; {@link createAppToolRunInstances}
   * additionally fails hard if a factory's id set is not stable, so a factory that
   * closes over something it should not is loud rather than silent.
   */
  tools: AppTool[] | AppToolFactory
}

// The catalogue derived from a factory, memoised per group. The picker reads it
// inside `useMemo` keyed on the group's identity, so it has to be the same array
// every render; it is also the reference each run's ids are validated against.
const catalogues = new WeakMap<AppToolGroup, AppTool[]>()

const uniqueIds = (tools: readonly AppTool[], groupId: string, which: string): Set<string> => {
  const ids = new Set<string>()
  for (const tool of tools) {
    if (ids.has(tool.id)) {
      throw new Error(
        `App tool group "${groupId}" ${which} contains more than one tool with id "${tool.id}". ` +
          'Tool ids key the picker, per-tool disablement and runtime registration, so they must be unique.'
      )
    }
    ids.add(tool.id)
  }
  return ids
}

/**
 * The group's stable catalogue: what the tool picker lists, what per-tool
 * disablement is keyed against, and where activity summarizers are resolved from.
 * Stable for the lifetime of the group object.
 */
export const appToolCatalogue = (group: AppToolGroup): AppTool[] => {
  if (Array.isArray(group.tools)) return group.tools
  const cached = catalogues.get(group)
  if (cached) return cached
  const built = group.tools('catalogue')
  uniqueIds(built, group.id, 'catalogue')
  catalogues.set(group, built)
  return built
}

/**
 * The instances to register for ONE run. Identical to the catalogue for a
 * stateless group; a fresh call to the factory otherwise.
 *
 * Throws rather than degrading when a factory's ids differ from the catalogue's.
 * The runtime filters these instances through a selection the reader made against
 * the catalogue, so a drifted id set means their choice is being applied to tools
 * they never saw — a programming error whose quiet failure mode (a tool silently
 * missing, or silently present) is exactly what this API exists to prevent.
 */
export const createAppToolRunInstances = (group: AppToolGroup): AppTool[] => {
  if (Array.isArray(group.tools)) return group.tools

  const catalogue = appToolCatalogue(group)
  const instances = group.tools('run')
  const expected = uniqueIds(catalogue, group.id, 'catalogue')
  const actual = uniqueIds(instances, group.id, 'per-run instances')

  // `Array.from`, not `[...set]`. A Babel build with `@babel/preset-env`'s
  // `loose: true` — Docusaurus's default client preset, which is what compiles
  // the documentation assistant — downlevels spread to `[].concat(x)`, which
  // wraps a Set as one opaque element instead of spreading its values. That made
  // this guard report every run as drifted and threw on every prompt. Same
  // hazard, same fix, as `deriveStarterPrompts` in conversation-empty-state.tsx.
  const missing = Array.from(expected)
    .filter((id) => !actual.has(id))
    .sort()
  const unexpected = Array.from(actual)
    .filter((id) => !expected.has(id))
    .sort()
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `App tool group "${group.id}" produced a different tool set for this run than for its catalogue` +
        (missing.length > 0 ? `; missing: ${missing.join(', ')}` : '') +
        (unexpected.length > 0 ? `; unexpected: ${unexpected.join(', ')}` : '') +
        '. The picker, per-tool disablement and the runtime all key on tool ids, so the set must not change between runs.'
    )
  }

  return instances
}
