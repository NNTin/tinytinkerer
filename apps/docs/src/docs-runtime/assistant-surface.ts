/**
 * The assistant's surface registry (issue #479): how a later issue puts UI
 * *inside* the assistant session without the session having to know about it.
 *
 * #479 mounts the runtime host as a SIBLING of the Docusaurus page subtree — it
 * cannot be an ancestor, because `BrowserAppShell` renders a boot screen in
 * place of its children and wraps them in StrictMode and an error boundary, and
 * documentation must not blank while an assistant boots. That settles where the
 * provider lives and creates this problem: #472's Pixel Agents Office is a docs
 * *page* component, so it can never be a React descendant of the provider by
 * position.
 *
 * It becomes one by portal. A consumer registers a component here, and — if it
 * wants that component drawn somewhere specific in the page — a DOM element to
 * draw it into. The host renders every registered surface inside the provider,
 * portaling those that named a target. The component is therefore a logical
 * descendant of the assistant session (one app, one conversation repository, one
 * query client) with a physical home wherever the page put its target.
 *
 * A surface with no target renders inline in the host, which is what #480's
 * floating widget wants.
 *
 * Light module: no product-runtime import, so a page component can register a
 * target without pulling the assistant chunk. `ComponentType` is a type-only
 * import and erases at build time.
 */
import type { ComponentType } from 'react'
import { createSubscribable } from './subscribable'

export type DocsAssistantSurface = {
  id: string
  Component: ComponentType
  /** Where to portal it, or null to render it inline in the runtime host. */
  target: HTMLElement | null
}

const components = new Map<string, ComponentType>()
const targets = new Map<string, HTMLElement>()
const { subscribe, emit } = createSubscribable()

// useSyncExternalStore compares snapshots by identity, so the array is rebuilt
// only when the registry actually changes — never per render, which would loop.
let snapshot: readonly DocsAssistantSurface[] = []

const rebuild = (): void => {
  snapshot = Array.from(components, ([id, Component]) => ({
    id,
    Component,
    target: targets.get(id) ?? null
  }))
  emit()
}

const readSurfaces = (): readonly DocsAssistantSurface[] => snapshot

const EMPTY: readonly DocsAssistantSurface[] = []
const readServerSurfaces = (): readonly DocsAssistantSurface[] => EMPTY

/**
 * Register a component to render inside the assistant session. Returns an
 * unregister function; registering the same id again replaces it.
 */
export const registerDocsAssistantSurface = (
  id: string,
  Component: ComponentType
): (() => void) => {
  components.set(id, Component)
  rebuild()
  return () => {
    // Only withdraw the registration still in place: a re-registration under the
    // same id (a fast refresh, a remount) must not be torn down by the previous
    // owner's cleanup.
    if (components.get(id) === Component) {
      components.delete(id)
      rebuild()
    }
  }
}

/**
 * Point a surface at the DOM element it should be portaled into, or clear it
 * with `null` when that element unmounts.
 */
export const setDocsAssistantSurfaceTarget = (id: string, target: HTMLElement | null): void => {
  if (target === null) {
    if (!targets.delete(id)) return
  } else {
    if (targets.get(id) === target) return
    targets.set(id, target)
  }
  rebuild()
}

export { subscribe as subscribeDocsAssistantSurfaces }
export { readSurfaces as readDocsAssistantSurfaces }
export { readServerSurfaces as readDocsAssistantSurfacesForServer }
