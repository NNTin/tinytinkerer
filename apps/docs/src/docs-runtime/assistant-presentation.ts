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
 * **Why the documentation is the authority at all.** The widget is not mounted
 * until something activates the runtime, so presentation must be readable before
 * `ChatApp` exists — #472's Office can be that activator. This store therefore
 * controls ChatApp with one complete `{ mode, minimized, edge }` value. Controlled
 * ChatApp never reads or writes a second presentation record, and its layouts
 * persist geometry only.
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
  useChatPresentation,
  type ChatPresentation
} from '@tinytinkerer/app-browser/chat-presentation'
import { DOCS_ASSISTANT_PRESENTATION_STORAGE_KEY } from './assistant-constants'

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
 * Adopt the widget's complete presentation request — minimize, restore, morph
 * and snap alike.
 *
 * One callback for mode, minimized, and edge is load-bearing: snap-docking must
 * not update an app-browser-private edge record while this host updates only the
 * mode. The ephemeral focus flag belongs to the activation that already
 * happened, so any subsequent widget interaction clears it. In particular it is
 * NOT set by the widget's own restore, which `FloatingLayout` already moves
 * focus for; the flag is only about a panel mounting for the first time.
 *
 * There is deliberately no per-axis mutator beside it. Partial setters were what
 * the #480 re-review found splitting presentation across two authorities, and
 * the pair that survived that fix (`setDocsAssistantMinimized`,
 * `setDocsAssistantMode`) had no caller left once the widget became fully
 * controlled — a named seam nothing drove, kept alive by its own tests (issue
 * #482). The product's own transitions are still available to a caller that
 * needs one, from `@tinytinkerer/app-browser/chat-presentation`.
 */
export const setDocsAssistantPresentation = (presentation: ChatPresentation): void => {
  store.update(() => ({ ...presentation, focusPanelOnMount: false }))
}

export const useDocsAssistantPresentation = (): DocsAssistantPresentationState =>
  useChatPresentation(store)

/** Test-only: drop the cached snapshot so the next read re-parses storage. */
export const resetDocsAssistantPresentationForTests = (): void => {
  store.reset()
}
