/**
 * Whether the reader has collapsed the sidebar Office (issue #472).
 *
 * Module-level and `localStorage`-backed for the same reason as everything else
 * in this directory: `@theme/Root` outlives every route, and a preference that
 * reset on navigation would be no preference at all.
 *
 * It is deliberately NOT part of `assistant-presentation.ts`. That record is the
 * product's own `ChatPresentation` — mode, minimized, dock edge — and is handed
 * to `ChatApp` as a controlled value. Whether a documentation sidebar shows a
 * room full of characters is not a fact about the chat panel, and folding it in
 * would mean either a non-product field in a product record or a second writer
 * of one.
 *
 * Collapsing is real, not cosmetic: the slot clears its portal target, so the
 * Office unmounts and its iframe stops. That is the space-and-cost control the
 * issue asks for.
 */
import { useSyncExternalStore } from 'react'
import { DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY } from './assistant-constants'
import { createSubscribable } from './subscribable'

const { subscribe, emit } = createSubscribable()

const readStored = (): boolean => {
  try {
    return window.localStorage.getItem(DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    // Storage denied (private mode, blocked cookies). Not collapsed is the
    // better default: the reader sees the thing rather than an empty strip.
    return false
  }
}

// Read once, lazily, then owned in memory — so a write from another tab does not
// silently reorganize this one's sidebar mid-read, and so every read after the
// first is free.
let collapsed: boolean | undefined

const read = (): boolean => {
  collapsed ??= readStored()
  return collapsed
}

// Static rendering has no storage and no reader preference to honour, so the
// server and the first client render agree on "expanded"; a stored `true`
// arrives on the following render. Nothing is drawn into the slot before
// activation anyway, so there is nothing to flash.
const readServer = (): boolean => false

export const setDocsAssistantOfficeCollapsed = (next: boolean): void => {
  if (read() === next) return
  collapsed = next
  try {
    window.localStorage.setItem(DOCS_ASSISTANT_OFFICE_COLLAPSED_STORAGE_KEY, String(next))
  } catch {
    // The preference still holds for this session; it just will not survive a
    // reload. Failing the toggle instead would be worse.
  }
  emit()
}

export const useDocsAssistantOfficeCollapsed = (): boolean =>
  useSyncExternalStore(subscribe, read, readServer)
