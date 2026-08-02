/**
 * When something else on the documentation page owns the reader's attention
 * (issue #480).
 *
 * The assistant sits above the ordinary Docusaurus chrome, which is right for a
 * navbar and wrong for the three surfaces that take over the viewport: a
 * fullscreen live lab, the mobile navigation drawer, and the search dropdown.
 * While one of those is open the widget is hidden completely — visually, from the
 * pointer, from the tab order, and from the accessibility tree — and then comes
 * back exactly as it was. It is never unmounted and its presentation state never
 * changes, so a reader who dismisses the search finds the same panel, the same
 * draft, and the same in-flight run.
 *
 * **Why not "any open `aria-modal`".** That generic rule would hide the assistant
 * the moment its OWN telemetry-consent dialog opened — the one dialog a first-time
 * reader has to be able to answer. So the overlays are named, and anything the
 * assistant renders is by construction not on the list.
 *
 * Two mechanisms, because the overlays have two different owners:
 *
 * - documentation-owned overlays report themselves through
 *   {@link setDocsHostOverlay}, which is exact and cannot drift;
 * - Docusaurus-owned overlays are detected by selectors that are part of a
 *   published contract rather than a build artifact — Infima's own
 *   `navbar-sidebar--show` class, and the WAI-ARIA combobox state the search
 *   bar's autocomplete maintains. CSS-module class names are hashed per build and
 *   would have been the wrong thing to match on.
 *
 * Light module: no product-runtime import, since the Root-mounted host reads it on
 * every route.
 */
import { useSyncExternalStore } from 'react'
import { createSubscribable } from './subscribable'

/**
 * Docusaurus-owned overlays, by a selector each.
 *
 * `navbar-sidebar--show` is set by theme-classic's Navbar layout while the mobile
 * drawer is open, and is what Infima's own stylesheet keys the drawer's transform
 * off. The search selector matches the navbar search input while its autocomplete
 * dropdown is expanded: `role="combobox"` + `aria-expanded` is the ARIA contract
 * the plugin's autocomplete implements, so it survives a dependency bump that
 * rehashes every class name.
 *
 * A selector that matches nothing is simply inert — this must never throw on a
 * page that has no navbar or no search.
 */
export const DOCS_HOST_OVERLAY_SELECTORS: readonly string[] = [
  '.navbar-sidebar--show',
  '.navbar__search [role="combobox"][aria-expanded="true"]'
]

// Documentation-owned overlays that reported themselves, by id.
const declared = new Set<string>()
const { subscribe, emit } = createSubscribable()

let open = false
let scheduled = false

const detect = (): boolean => {
  if (declared.size > 0) return true
  if (typeof document === 'undefined') return false
  return DOCS_HOST_OVERLAY_SELECTORS.some((selector) => document.querySelector(selector) !== null)
}

const evaluate = (): void => {
  const next = detect()
  if (next === open) return
  open = next
  emit()
}

// Coalesced to one evaluation per frame: a class toggle on the navbar can arrive
// as a burst of mutations, and each would otherwise run every selector again.
const scheduleEvaluate = (): void => {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    evaluate()
  })
}

let observer: MutationObserver | null = null
let watchers = 0

const startObserving = (): void => {
  watchers += 1
  if (observer || typeof document === 'undefined') return
  observer = new MutationObserver(scheduleEvaluate)
  // Attributes for the drawer's class and the combobox's `aria-expanded`;
  // childList because the search dropdown's input is mounted and unmounted with
  // the navbar on some routes. Filtered to two attributes so ordinary Docusaurus
  // churn (scroll-driven navbar classes) is not re-running selectors on every
  // frame it happens to touch something else.
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-expanded']
  })
  evaluate()
}

const stopObserving = (): void => {
  watchers -= 1
  if (watchers > 0 || !observer) return
  observer.disconnect()
  observer = null
}

const subscribeToOverlays = (listener: () => void): (() => void) => {
  const unsubscribe = subscribe(listener)
  startObserving()
  return () => {
    unsubscribe()
    stopObserving()
  }
}

/**
 * Declare a documentation-owned overlay open or closed. Idempotent, and keyed by
 * id so two labs in fullscreen at once (which cannot happen today, but costs
 * nothing to be right about) do not cancel each other out.
 */
export const setDocsHostOverlay = (id: string, isOpen: boolean): void => {
  if (isOpen) {
    if (declared.has(id)) return
    declared.add(id)
  } else if (!declared.delete(id)) {
    return
  }
  evaluate()
}

const read = (): boolean => open

// Static rendering has no overlays and no DOM to inspect. The server and the
// first client render therefore agree on `false`, and the observer's first
// evaluation runs immediately after subscription.
const readServer = (): boolean => false

/** Whether a host overlay currently owns the viewport. */
export const useDocsHostOverlayOpen = (): boolean =>
  useSyncExternalStore(subscribeToOverlays, read, readServer)

/**
 * Test-only: forget declared overlays and re-evaluate from a clean slate.
 *
 * It EMITS when that changes the answer, for the same reason every other writer
 * here does. `useSyncExternalStore` caches the last snapshot it was told about,
 * so a silent write leaves a mounted subscriber rendering `true` against a store
 * that now reads `false` — and the next real change from `false` is then
 * swallowed by the `next === open` guard in {@link evaluate}. A reset helper that
 * desynchronises the thing it is resetting is worse than no helper.
 */
export const resetDocsHostOverlaysForTests = (): void => {
  declared.clear()
  evaluate()
}
