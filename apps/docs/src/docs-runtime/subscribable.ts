/**
 * The listener bookkeeping behind this directory's two light module stores
 * (issue #479): activation status and the surface registry.
 *
 * Both publish module-level state that must outlive every route — Docusaurus
 * keeps `@theme/Root` mounted across SPA navigation, so React state would be the
 * wrong home — and both are read through `useSyncExternalStore`. This is the
 * three lines they would otherwise each keep their own copy of.
 *
 * Deliberately not a store: it holds no value and knows nothing about what
 * changed. Each module keeps its own state, and its own rule for when a write
 * counts as a change (the surface registry, for one, must not emit for a no-op
 * write, or a subscriber comparing snapshots by identity would re-render
 * forever).
 */
export type Subscribable = {
  subscribe: (listener: () => void) => () => void
  emit: () => void
}

export const createSubscribable = (): Subscribable => {
  const listeners = new Set<() => void>()

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    // Snapshot first: a listener may unsubscribe while we iterate.
    emit: () => {
      for (const listener of Array.from(listeners)) listener()
    }
  }
}
