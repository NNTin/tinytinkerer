/**
 * Whether the documentation assistant is showing its panel or its launcher
 * (issue #480) — and the only authority on that question.
 *
 * Separate from everything else the assistant persists, on purpose. Conversations,
 * settings and model selection live in the `tinytinkerer-docs-assistant` IndexedDB
 * database; this is one small enum in `localStorage`, so resetting a conversation
 * cannot collapse the panel and collapsing the panel cannot touch a conversation.
 *
 * **Why the docs own it rather than `FloatingLayout`.** The layout persists a
 * `minimized` flag inside its geometry blob, which is the right design for a shell
 * that mounts its widget on page load. Here the widget is not mounted at all until
 * something activates the runtime, so that flag would be a second authority written
 * by a component that only exists after the decision has already been made. The two
 * disagree the moment anything but the launcher opens the assistant — #472's Office
 * activating the runtime while the reader had it minimized is exactly that case. So
 * the widget renders `FloatingLayout` in its CONTROLLED mode and this module is the
 * single answer.
 *
 * Light by construction: no product-runtime import, so `@theme/Root` can read it on
 * every documentation route without pulling the assistant chunk.
 */
import { useSyncExternalStore } from 'react'
import { DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY } from './assistant-constants'
import { createSubscribable } from './subscribable'

export type DocsAssistantPresentation =
  /** Only the launcher is shown. The default, and a new visitor's state. */
  | 'minimized'
  /** The panel is open, and the runtime is (or is being) activated. */
  | 'open'

export type DocsAssistantPresentationState = {
  presentation: DocsAssistantPresentation
  /**
   * Whether the widget should take focus when it next mounts.
   *
   * True only after a reader activates the assistant themselves: that click is a
   * request to start typing. It stays false when a returning reader's persisted
   * `open` restores the panel during page load, where stealing focus would yank a
   * keyboard user out of the documentation they came to read.
   */
  focusPanelOnMount: boolean
}

/**
 * The persisted shape, versioned so a later change can be recognised rather than
 * guessed at. Anything unrecognised is treated as "no preference" and the reader
 * gets the default, which is the conservative direction: a launcher, and no
 * runtime download.
 */
const STORAGE_VERSION = 1

type PersistedState = { version: number; presentation: DocsAssistantPresentation }

const DEFAULT_STATE: DocsAssistantPresentationState = {
  presentation: 'minimized',
  focusPanelOnMount: false
}

const readPersisted = (): DocsAssistantPresentation => {
  try {
    const raw = window.localStorage.getItem(DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY)
    if (!raw) return 'minimized'
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return 'minimized'
    const { version, presentation } = parsed as Partial<PersistedState>
    if (version !== STORAGE_VERSION) return 'minimized'
    return presentation === 'open' ? 'open' : 'minimized'
  } catch {
    // Private-mode storage, a quota error, corrupt JSON: all mean the same
    // thing here, and none of them should stop the assistant from working.
    return 'minimized'
  }
}

const writePersisted = (presentation: DocsAssistantPresentation): void => {
  try {
    window.localStorage.setItem(
      DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, presentation } satisfies PersistedState)
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
  state ??= { presentation: readPersisted(), focusPanelOnMount: false }
  return state
}

// Static rendering and the hydration pass have no storage to read, so they always
// report the default. React re-renders with the real value straight afterwards,
// which is what keeps the server and first client render in agreement.
const readServer = (): DocsAssistantPresentationState => DEFAULT_STATE

const publish = (next: DocsAssistantPresentationState): void => {
  const current = read()
  if (
    current.presentation === next.presentation &&
    current.focusPanelOnMount === next.focusPanelOnMount
  ) {
    return
  }
  state = next
  writePersisted(next.presentation)
  emit()
}

/** The current state, for a non-React caller (and for tests). */
export const readDocsAssistantPresentation = (): DocsAssistantPresentationState => read()

/**
 * Open the assistant because the reader asked for it. Marks the mount as
 * focus-worthy; the caller still starts the runtime.
 */
export const openDocsAssistant = (): void => {
  publish({ presentation: 'open', focusPanelOnMount: true })
}

/**
 * Report the widget's own minimize/restore. Never sets `focusPanelOnMount`:
 * `FloatingLayout` already moves focus itself when a reader restores a mounted
 * panel, and this flag is only about a panel that is mounting for the first time.
 */
export const setDocsAssistantMinimized = (minimized: boolean): void => {
  publish({ presentation: minimized ? 'minimized' : 'open', focusPanelOnMount: false })
}

export const useDocsAssistantPresentation = (): DocsAssistantPresentationState =>
  useSyncExternalStore(subscribe, read, readServer)

/** Test-only: drop the cached snapshot so the next read re-parses storage. */
export const resetDocsAssistantPresentationForTests = (): void => {
  state = null
}
