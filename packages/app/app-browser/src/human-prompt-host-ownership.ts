/**
 * Which shell draws an app's human-in-the-loop modal, when the app has several
 * (issue #489 review, finding 2).
 *
 * A `BrowserApp` can be mounted by more than one `BrowserAppShell` — every
 * `<LiveLab>` on a documentation page mounts its own shell over the one shared
 * lab app. The composer dock is fine that way: it is part of a chat surface, and
 * several surfaces of one session may each show that session's question, because
 * answering through any one settles it for all.
 *
 * The modal is not fine that way. It is an app-level interrupt — a fixed
 * full-viewport overlay with `aria-modal="true"` — and two of them for one
 * question means two overlays, two dialogs claiming the document, two copies of
 * the controls, and two entries competing in the shared focus stack. So exactly
 * one mounted shell per app draws it.
 *
 * ## Why an election rather than a prop
 *
 * The alternative was to make the embedder say which shell owns the modal, the
 * way `preSendDisclosureHost` documents ("an app that declares a disclosure must
 * mount exactly one shell"). A comment is not a mechanism: it is invisible at the
 * call site, it cannot be right for a page that mounts a variable number of labs,
 * and getting it wrong produces duplicate modals rather than an error.
 *
 * Ownership is therefore decided by mount order, and handed on: the first shell
 * to mount for an app owns the modal, and if it unmounts the next one does,
 * without the prompt itself being disturbed — the queue lives on the app, so a
 * pending question survives its renderer being replaced.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { BrowserApp } from './app'

type Registry = {
  // Mounted candidates in mount order; `candidates[0]` owns the modal. An array
  // rather than a single `owner` slot so a handoff needs no re-election pass:
  // removing the head simply promotes whoever mounted next.
  candidates: symbol[]
  listeners: Set<() => void>
}

// Keyed on the app object, so a discarded app takes its registry with it —
// matching how `pre-send-disclosure.ts` keys its per-app store.
const registries = new WeakMap<BrowserApp, Registry>()

const registryFor = (app: BrowserApp): Registry => {
  const existing = registries.get(app)
  if (existing) return existing
  const created: Registry = { candidates: [], listeners: new Set() }
  registries.set(app, created)
  return created
}

const emit = (registry: Registry): void => {
  for (const listener of registry.listeners) listener()
}

/**
 * Whether the calling shell is the one that should render this app's modal.
 *
 * `false` while the app cannot prompt at all — an app with no queue has no modal
 * to own — so a caller can gate on this single value rather than checking both.
 */
export const useOwnsHumanPromptHost = (app: BrowserApp): boolean => {
  const canPrompt = app.stores.humanPrompts !== undefined
  // One identity per mounted component instance, stable across renders. `useRef`
  // rather than `useId` because this is a queue position, not a DOM id, and it
  // must be comparable by reference.
  const token = useRef<symbol | undefined>(undefined)
  token.current ??= Symbol('human-prompt-host')

  const registry = useMemo(() => (canPrompt ? registryFor(app) : undefined), [app, canPrompt])

  useEffect(() => {
    if (!registry) return undefined
    const claim = token.current as symbol
    registry.candidates = [...registry.candidates, claim]
    emit(registry)
    return () => {
      registry.candidates = registry.candidates.filter((entry) => entry !== claim)
      // Emit on release too: the shell promoted into the head has to re-render
      // to start drawing, and nothing else would tell it.
      emit(registry)
    }
    // React StrictMode runs this twice in development (mount/unmount/mount).
    // Because the cleanup removes exactly the entry the effect added, the second
    // pass leaves the same single entry rather than two.
  }, [registry])

  return useSyncExternalStore(
    (onStoreChange) => {
      if (!registry) return () => undefined
      registry.listeners.add(onStoreChange)
      return () => {
        registry.listeners.delete(onStoreChange)
      }
    },
    () => registry !== undefined && registry.candidates[0] === token.current,
    // Static rendering mounts nothing and owns nothing.
    () => false
  )
}
