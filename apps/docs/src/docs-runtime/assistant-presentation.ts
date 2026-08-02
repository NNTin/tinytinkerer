/**
 * How the documentation assistant is presented — floating or docked, panel or
 * launcher — and the only authority on that question (issue #480).
 *
 * **The rules are the product's, not the documentation's** (issue #480
 * re-review, finding 2). The mode union, the versioned record, its parser, the
 * transitions and the store all come from
 * `@tinytinkerer/app-browser/chat-presentation`, which `ChatApp` uses too. What
 * remains here is the two things that really are this host's: WHICH key the
 * record lives under, and one ephemeral flag (`focusPanelOnMount`) that is about
 * how a mount came about rather than about the presentation itself.
 *
 * **Why the documentation is the authority at all.** `FloatingLayout` persists a
 * `minimized` flag inside its geometry blob and `ChatApp` persists its own
 * record, which is the right design for a shell that mounts its widget on page
 * load. Here the widget is not mounted at all until something activates the
 * runtime, so both would be written by components that only exist after the
 * decision has already been made. They disagree the moment anything but the
 * launcher opens the assistant — #472's Office activating the runtime while the
 * reader had it minimized is exactly that case — and a two-authority split is
 * worse once `mode` is in play, because "is the assistant showing?" then depends
 * on which of the two stores you ask. So this store is the single authority, and
 * `ChatApp` renders in its CONTROLLED mode against it.
 *
 * Separate from everything else the assistant persists, on purpose. Conversations,
 * settings and model selection live in the `tinytinkerer-docs-assistant` IndexedDB
 * database; this is one small versioned record in `localStorage`, so resetting a
 * conversation cannot collapse the panel and collapsing the panel cannot touch a
 * conversation.
 *
 * Light by construction: the subpath imported below pulls React and nothing else,
 * so `@theme/Root` can read this on every documentation route without the
 * assistant chunk.
 */
import {
  createChatPresentationStore,
  isChatPresentationOpen,
  openChatPresentation,
  setChatPresentationMinimized,
  setChatPresentationMode,
  useChatPresentation,
  type ChatMode,
  type ChatPresentation
} from '@tinytinkerer/app-browser/chat-presentation'
import { DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY } from './assistant-constants'

/** Which layout the assistant renders in. The product's union, not a copy of it. */
export type DocsAssistantMode = ChatMode

export type DocsAssistantPresentationState = ChatPresentation & {
  /**
   * Whether the widget should take focus when it next mounts.
   *
   * True only after a reader activates the assistant themselves: that click is a
   * request to start typing. It stays false when a returning reader's persisted
   * state restores the panel during page load, where stealing focus would yank a
   * keyboard user out of the documentation they came to read.
   *
   * Ephemeral, and therefore never part of the persisted record — it describes
   * how this mount came about, which no reload can inherit.
   */
  focusPanelOnMount: boolean
}

const store = createChatPresentationStore<DocsAssistantPresentationState>({
  storageKey: DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY,
  hydrate: (persisted) => ({ ...persisted, focusPanelOnMount: false })
})

/**
 * Whether the assistant is showing a panel — the single question the runtime host
 * activates on.
 */
export const isDocsAssistantOpen = (value: DocsAssistantPresentationState): boolean =>
  isChatPresentationOpen(value)

/** The current state, for a non-React caller (and for tests). */
export const readDocsAssistantPresentation = (): DocsAssistantPresentationState => store.read()

/**
 * Open the assistant because the reader asked for it. Marks the mount as
 * focus-worthy; the caller still starts the runtime. The mode they left it in is
 * preserved — a reader who docked the assistant and reloaded gets it docked back.
 */
export const openDocsAssistant = (): void => {
  store.update((current) => ({ ...openChatPresentation(current), focusPanelOnMount: true }))
}

/**
 * Report the widget's own minimize/restore. Never sets `focusPanelOnMount`:
 * `FloatingLayout` already moves focus itself when a reader restores a mounted
 * panel, and this flag is only about a panel that is mounting for the first time.
 */
export const setDocsAssistantMinimized = (minimized: boolean): void => {
  store.update((current) => ({
    ...setChatPresentationMinimized(current, minimized),
    focusPanelOnMount: false
  }))
}

/** Report the widget's own dock/undock. */
export const setDocsAssistantMode = (mode: DocsAssistantMode): void => {
  store.update((current) => setChatPresentationMode(current, mode))
}

export const useDocsAssistantPresentation = (): DocsAssistantPresentationState =>
  useChatPresentation(store)

/** Test-only: drop the cached snapshot so the next read re-parses storage. */
export const resetDocsAssistantPresentationForTests = (): void => {
  store.reset()
}
