/**
 * How the documentation assistant is presented — floating or docked, panel or
 * launcher — and the only authority on that question (issue #480).
 *
 * Separate from everything else the assistant persists, on purpose. Conversations,
 * settings and model selection live in the `tinytinkerer-docs-assistant` IndexedDB
 * database; this is one small versioned record in `localStorage`, so resetting a
 * conversation cannot collapse the panel and collapsing the panel cannot touch a
 * conversation.
 *
 * **Why the docs own it rather than `ChatApp`.** `FloatingLayout` persists a
 * `minimized` flag inside its geometry blob and `ChatApp` persists `mode` under
 * its own key, which is the right design for a shell that mounts its widget on
 * page load. Here the widget is not mounted at all until something activates the
 * runtime, so both would be written by components that only exist after the
 * decision has already been made. They disagree the moment anything but the
 * launcher opens the assistant — #472's Office activating the runtime while the
 * reader had it minimized is exactly that case — and a two-authority split is
 * worse once `mode` is in play, because "is the assistant showing?" then depends
 * on which of the two stores you ask.
 *
 * So this is ONE versioned record covering both axes, and `ChatApp` renders in
 * its CONTROLLED mode against it.
 *
 * Light by construction: no product-runtime import, so `@theme/Root` can read it on
 * every documentation route without pulling the assistant chunk.
 */
import { useSyncExternalStore } from 'react'
import { DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY } from './assistant-constants'
import { createSubscribable } from './subscribable'

/** Which layout the assistant renders in. Mirrors `ChatApp`'s own `ChatMode`. */
export type DocsAssistantMode = 'floating' | 'sidebar'

export type DocsAssistantPresentationState = {
  mode: DocsAssistantMode
  /**
   * Whether the floating widget is collapsed to its launcher.
   *
   * Meaningful in `floating` mode only: a docked panel has no collapsed state, so
   * a reader who docks is showing the assistant whatever this says. It is kept
   * rather than cleared so that undocking returns them to the panel they had.
   */
  minimized: boolean
  /**
   * Whether the widget should take focus when it next mounts.
   *
   * True only after a reader activates the assistant themselves: that click is a
   * request to start typing. It stays false when a returning reader's persisted
   * state restores the panel during page load, where stealing focus would yank a
   * keyboard user out of the documentation they came to read.
   */
  focusPanelOnMount: boolean
}

/**
 * The persisted shape, versioned so a later change can be recognised rather than
 * guessed at. Anything unrecognised is treated as "no preference" and the reader
 * gets the default, which is the conservative direction: a launcher, and no
 * runtime download.
 *
 * Version 2 added `mode`. A version-1 record is deliberately NOT migrated: it
 * recorded only `presentation: 'minimized' | 'open'`, and this shipped in no
 * release, so there is no reader whose stored preference is worth guessing at.
 */
const STORAGE_VERSION = 2

type PersistedState = { version: number; mode: DocsAssistantMode; minimized: boolean }

const DEFAULT_STATE: DocsAssistantPresentationState = {
  mode: 'floating',
  minimized: true,
  focusPanelOnMount: false
}

type PersistedPresentation = Pick<DocsAssistantPresentationState, 'mode' | 'minimized'>

const readPersisted = (): PersistedPresentation => {
  const fallback: PersistedPresentation = {
    mode: DEFAULT_STATE.mode,
    minimized: DEFAULT_STATE.minimized
  }
  try {
    const raw = window.localStorage.getItem(DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return fallback
    const { version, mode, minimized } = parsed as Partial<PersistedState>
    if (version !== STORAGE_VERSION) return fallback
    return {
      mode: mode === 'sidebar' ? 'sidebar' : 'floating',
      minimized: minimized !== false
    }
  } catch {
    // Private-mode storage, a quota error, corrupt JSON: all mean the same
    // thing here, and none of them should stop the assistant from working.
    return fallback
  }
}

const writePersisted = (next: DocsAssistantPresentationState): void => {
  try {
    window.localStorage.setItem(
      DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        mode: next.mode,
        minimized: next.minimized
      } satisfies PersistedState)
    )
  } catch {
    // Non-fatal: the presentation just will not survive this reload.
  }
}

// Read lazily and then cached, because `useSyncExternalStore` compares snapshots
// by identity and calls `getSnapshot` on every render — parsing localStorage each
// time would allocate a new object and re-render forever.
let state: DocsAssistantPresentationState | null = null
const { subscribe, emit } = createSubscribable()

const read = (): DocsAssistantPresentationState => {
  state ??= { ...readPersisted(), focusPanelOnMount: false }
  return state
}

// Static rendering and the hydration pass have no storage to read, so they always
// report the default. React re-renders with the real value straight afterwards,
// which is what keeps the server and first client render in agreement.
const readServer = (): DocsAssistantPresentationState => DEFAULT_STATE

const publish = (next: DocsAssistantPresentationState): void => {
  const current = read()
  if (
    current.mode === next.mode &&
    current.minimized === next.minimized &&
    current.focusPanelOnMount === next.focusPanelOnMount
  ) {
    return
  }
  state = next
  writePersisted(next)
  emit()
}

/**
 * Whether the assistant is showing a panel — the single question the runtime host
 * activates on.
 *
 * A docked assistant is always showing one: `SidebarLayout` has no collapsed
 * state, so `minimized` is only ever about the floating widget.
 */
export const isDocsAssistantOpen = (value: DocsAssistantPresentationState): boolean =>
  value.mode === 'sidebar' || !value.minimized

/** The current state, for a non-React caller (and for tests). */
export const readDocsAssistantPresentation = (): DocsAssistantPresentationState => read()

/**
 * Open the assistant because the reader asked for it. Marks the mount as
 * focus-worthy; the caller still starts the runtime. The mode they left it in is
 * preserved — a reader who docked the assistant and reloaded gets it docked back.
 */
export const openDocsAssistant = (): void => {
  publish({ ...read(), minimized: false, focusPanelOnMount: true })
}

/**
 * Report the widget's own minimize/restore. Never sets `focusPanelOnMount`:
 * `FloatingLayout` already moves focus itself when a reader restores a mounted
 * panel, and this flag is only about a panel that is mounting for the first time.
 */
export const setDocsAssistantMinimized = (minimized: boolean): void => {
  publish({ ...read(), minimized, focusPanelOnMount: false })
}

/**
 * Report the widget's own dock/undock.
 *
 * Docking clears `minimized` too: the reader pressed dock on an open panel, and
 * leaving the flag set would collapse the assistant the moment they undocked.
 */
export const setDocsAssistantMode = (mode: DocsAssistantMode): void => {
  const current = read()
  publish({
    ...current,
    mode,
    minimized: mode === 'sidebar' ? false : current.minimized
  })
}

export const useDocsAssistantPresentation = (): DocsAssistantPresentationState =>
  useSyncExternalStore(subscribe, read, readServer)

/** Test-only: drop the cached snapshot so the next read re-parses storage. */
export const resetDocsAssistantPresentationForTests = (): void => {
  state = null
}
