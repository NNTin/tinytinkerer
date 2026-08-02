/**
 * How a chat surface is PRESENTED — floating or docked, panel or launcher, and
 * against which viewport edge — as one versioned record with one set of
 * transitions (issue #480 re-review, finding 2).
 *
 * This is the product's answer, not any one host's. `ChatApp` uses it for its
 * uncontrolled mode, and a host that wants to be the single authority over
 * presentation (the documentation assistant, which must decide whether to show a
 * panel BEFORE the runtime chunk exists) builds a store from it and renders
 * `ChatApp` controlled against that store. Before this module the two each
 * defined the mode union, their own storage schema, their own parser and their
 * own transition rules, which is exactly the "second implementation behind a
 * parity promise" this file exists to end.
 *
 * ## Deliberately dependency-light
 *
 * React's `useSyncExternalStore` and nothing else. No product runtime, no
 * stores, no components. That is load-bearing: `@theme/Root` on the
 * documentation site imports a store built from this on every route, and a
 * transitive import of the product runtime here would put the whole assistant
 * chunk in every documentation page's initial HTML — which
 * scripts/check-docs-performance-budget.mjs fails the build over.
 *
 * Import it from the `@tinytinkerer/app-browser/chat-presentation` subpath, NOT
 * from the package barrel, which does pull the runtime.
 */
import { useSyncExternalStore } from 'react'

/** Which layout a chat surface renders in. */
export type ChatMode = 'floating' | 'sidebar'

/** Which viewport edge the docked layout fills. */
export type ChatDockEdge = 'top' | 'bottom' | 'left' | 'right'

export type ChatPresentation = {
  mode: ChatMode
  /**
   * Whether the floating layout is collapsed to its launcher.
   *
   * Meaningful in `floating` mode only: the docked layout has no collapsed
   * state, so a reader who docks is showing the chat whatever this says. It is
   * kept rather than cleared so undocking returns them to the panel they had.
   */
  minimized: boolean
  /** Which edge a dock targets. Only meaningful in `sidebar` mode. */
  edge: ChatDockEdge
}

export const DEFAULT_CHAT_PRESENTATION: ChatPresentation = {
  mode: 'floating',
  minimized: true,
  edge: 'right'
}

// ---------------------------------------------------------------------------
// Transitions. Pure, total, and the only place the rules are written.
// ---------------------------------------------------------------------------

/** Show the panel. The mode is preserved — a reader who docked stays docked. */
export const openChatPresentation = <T extends ChatPresentation>(current: T): T => ({
  ...current,
  minimized: false
})

/** Report a minimize or restore of the floating panel. */
export const setChatPresentationMinimized = <T extends ChatPresentation>(
  current: T,
  minimized: boolean
): T => ({ ...current, minimized })

/**
 * Report a dock or undock.
 *
 * Docking clears `minimized` too: the reader pressed dock on an open panel, and
 * leaving the flag set would collapse the chat the moment they undocked.
 */
export const setChatPresentationMode = <T extends ChatPresentation>(
  current: T,
  mode: ChatMode,
  edge?: ChatDockEdge
): T => ({
  ...current,
  mode,
  ...(edge === undefined ? {} : { edge }),
  minimized: mode === 'sidebar' ? false : current.minimized
})

/**
 * Whether a panel is showing at all — the single question an embedder activates
 * on. A docked chat is always showing one.
 */
export const isChatPresentationOpen = (current: ChatPresentation): boolean =>
  current.mode === 'sidebar' || !current.minimized

// ---------------------------------------------------------------------------
// Persistence.
// ---------------------------------------------------------------------------

/**
 * The persisted record's version, so a later change can be recognised rather
 * than guessed at. An unrecognised record is treated as "no preference" and the
 * reader gets the default, which is the conservative direction: a launcher, and
 * (for an embedder) no runtime download.
 *
 * Starts at 3, not 1. Versions 1 and 2 were the documentation assistant's own
 * private predecessors on its own key, and neither shipped in a release, so
 * neither is migrated — but reusing their numbers on the same key for a
 * different shape would be a collision waiting to happen.
 */
export const CHAT_PRESENTATION_STORAGE_VERSION = 3

type PersistedRecord = {
  version: number
  mode: ChatMode
  minimized: boolean
  edge: ChatDockEdge
}

const isMode = (value: unknown): value is ChatMode => value === 'floating' || value === 'sidebar'

const isEdge = (value: unknown): value is ChatDockEdge =>
  value === 'top' || value === 'bottom' || value === 'left' || value === 'right'

/**
 * Parse a stored record. `null` for anything unrecognised — absent, corrupt, or
 * a version this build does not know — which callers turn into the default.
 */
export const parseChatPresentation = (raw: string | null): ChatPresentation | null => {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { version, mode, minimized, edge } = parsed as Partial<PersistedRecord>
  if (version !== CHAT_PRESENTATION_STORAGE_VERSION) return null
  return {
    mode: isMode(mode) ? mode : DEFAULT_CHAT_PRESENTATION.mode,
    minimized: minimized !== false,
    edge: isEdge(edge) ? edge : DEFAULT_CHAT_PRESENTATION.edge
  }
}

export const serializeChatPresentation = (value: ChatPresentation): string =>
  JSON.stringify({
    version: CHAT_PRESENTATION_STORAGE_VERSION,
    mode: value.mode,
    minimized: value.minimized,
    edge: value.edge
  } satisfies PersistedRecord)

/** The storage key a base key's presentation record lives under. */
export const chatPresentationStorageKey = (storageKey: string): string =>
  `${storageKey}:presentation`

/**
 * Read the record for `storageKey`, or `null`.
 *
 * Private-mode storage, a quota error and corrupt JSON all mean the same thing
 * here, and none of them should stop a chat surface from working.
 */
export const readChatPresentation = (storageKey: string): ChatPresentation | null => {
  try {
    return parseChatPresentation(
      window.localStorage.getItem(chatPresentationStorageKey(storageKey))
    )
  } catch {
    return null
  }
}

/** Persist the record. Non-fatal on failure: the presentation just will not survive a reload. */
export const writeChatPresentation = (storageKey: string, value: ChatPresentation): void => {
  try {
    window.localStorage.setItem(
      chatPresentationStorageKey(storageKey),
      serializeChatPresentation(value)
    )
  } catch {
    // Non-fatal.
  }
}

// ---------------------------------------------------------------------------
// The store, for a host that owns presentation outright.
// ---------------------------------------------------------------------------

export type ChatPresentationStore<T extends ChatPresentation> = {
  /** The current value, for a non-React caller (and for tests). */
  read: () => T
  /** Apply a transition and publish the result. */
  update: (transition: (current: T) => T) => void
  subscribe: (listener: () => void) => () => void
  /** Drop the cached value so the next read re-parses storage. Test-only. */
  reset: () => void
  /** The value static rendering and the hydration pass see. */
  readServer: () => T
}

export type ChatPresentationStoreOptions<T extends ChatPresentation> = {
  /** Base key; the record is persisted under {@link chatPresentationStorageKey}. */
  storageKey: string
  /**
   * Add the host's own EPHEMERAL fields to a record read from storage.
   *
   * Anything a host derives per session rather than persists — the documentation
   * assistant's "did the reader just click the launcher?" — belongs here, so it
   * is present on every value the store hands out but never written back.
   */
  hydrate?: (persisted: ChatPresentation) => T
}

const shallowEqual = <T extends object>(a: T, b: T): boolean => {
  const keys = Object.keys(a) as (keyof T)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

/**
 * A module-scoped presentation store.
 *
 * The value is read lazily and then CACHED, because `useSyncExternalStore`
 * compares snapshots by identity and calls `getSnapshot` on every render —
 * parsing storage each time would allocate a new object and re-render forever.
 */
export const createChatPresentationStore = <T extends ChatPresentation = ChatPresentation>(
  options: ChatPresentationStoreOptions<T>
): ChatPresentationStore<T> => {
  const hydrate = options.hydrate ?? ((persisted: ChatPresentation): T => persisted as T)
  // Static rendering and the hydration pass have no storage to read, so they
  // always report the default. React re-renders with the real value straight
  // afterwards, which is what keeps the server and first client render in
  // agreement. One frozen object, so its identity is stable.
  const serverValue = hydrate(DEFAULT_CHAT_PRESENTATION)
  const listeners = new Set<() => void>()
  let value: T | null = null

  const read = (): T =>
    (value ??= hydrate(readChatPresentation(options.storageKey) ?? DEFAULT_CHAT_PRESENTATION))

  return {
    read,
    readServer: () => serverValue,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update: (transition) => {
      const current = read()
      const next = transition(current)
      if (shallowEqual(current, next)) return
      value = next
      writeChatPresentation(options.storageKey, next)
      for (const listener of listeners) listener()
    },
    reset: () => {
      value = null
    }
  }
}

export const useChatPresentation = <T extends ChatPresentation>(
  store: ChatPresentationStore<T>
): T => useSyncExternalStore(store.subscribe, store.read, store.readServer)
