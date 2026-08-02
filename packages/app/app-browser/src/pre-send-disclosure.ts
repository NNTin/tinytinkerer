/**
 * A one-time, app-scoped disclosure a reader must acknowledge before this app
 * sends its first prompt (issue #481).
 *
 * ## Why this is a `BrowserApp` capability and not a docs component
 *
 * The documentation assistant has to tell a reader, before anything leaves the
 * browser, that the model receives the conversation plus whatever source
 * Markdown its documentation tools chose to read. Three shapes were rejected:
 *
 * - **Adding the text to the telemetry consent dialog.** That dialog asks for an
 *   opt-in that defaults to off and can be declined while the app keeps working.
 *   A data-flow disclosure is not a choice — declining means not using the
 *   assistant — so "Continue without" would read as "use the assistant without
 *   sending anything to a model", which is false.
 * - **Duplicating a check in the floating and docked chat surfaces.** Two
 *   conditionals guarding one rule, and #472's Office would need a third.
 * - **Routing it through the human-in-the-loop bridge.** That queue is
 *   module-global with no session identity — the exact defect #489 exists to
 *   close — so a second `BrowserApp` in the document would draw the prompt with
 *   the wrong app's settings.
 *
 * So the gate is one optional capability on the app, enforced in the single
 * `submitPrompt` every surface already shares, and drawn by one host mounted
 * above every surface of that app. Every existing product app omits the
 * capability and behaves exactly as before.
 *
 * ## Why the STORE lives here and not on the app
 *
 * `app.ts` is imported by every shell's startup entry, and `apps/shell`'s entry
 * budget had 0.23 kB of headroom — this store, constructed there, cost 1.2 kB and
 * broke it, for a capability none of the product endpoints uses.
 *
 * So the eager half is one preference read (`app.ts`, during
 * `initializeBrowserApp`), and the store itself is created lazily, memoized per
 * app, by the first surface that asks. Every caller — the chat composer, the
 * disclosure host, the settings panel — already lives in a lazily-loaded chunk.
 *
 * The eager read is what keeps the gate honest despite the lazy store: the store
 * is created ALREADY hydrated, so `isRequired()` never has to answer "I don't
 * know yet" for a reader who acknowledged this months ago.
 *
 * ## What it is NOT
 *
 * Not telemetry consent, and not the global privacy-policy acknowledgement.
 * All three are versioned separately and none substitutes for another: the
 * acknowledgement here is persisted in **this app's** preferences namespace, so
 * the documentation assistant's disclosure cannot be satisfied by a product
 * user having dismissed a policy-update notice, or vice versa.
 */
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useBrowserApp, type BrowserApp } from './app'
import {
  PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY,
  type PreSendDisclosure
} from './pre-send-disclosure-key'

// Re-exported so consumers have one place to import the whole capability from,
// even though `app.ts` reaches past this module for the two pieces it needs.
export { PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY }
export type { PreSendDisclosure }

export type PreSendDisclosureRequest = {
  /** Identifies one composer's attempt, so only that composer resumes it. */
  requestId: number
  /** The trimmed prompt the reader tried to send. */
  prompt: string
}

export type PreSendDisclosureState = {
  /** The configured disclosure, or `undefined` for every app without one. */
  disclosure: PreSendDisclosure | undefined
  /** The version this reader last acknowledged in this app's namespace. */
  acknowledgedVersion: string | null
  /** The attempt waiting on an answer, if the gate is open. */
  pending: PreSendDisclosureRequest | null
  /**
   * The most recently accepted `requestId`. The composer that raised it watches
   * this and re-submits, so the send goes through the ONE `submitPrompt` path
   * rather than a second copy of the send logic living in the dialog.
   */
  lastAccepted: number | null
  /** Whether the next send must be gated. */
  isRequired: () => boolean
  /** Open the gate for `prompt` and return the id the composer should watch. */
  request: (prompt: string) => number
  /** Persist the acknowledgement and release the pending attempt. */
  accept: () => Promise<void>
  /** Close the gate without acknowledging. The composer keeps its text. */
  dismiss: () => void
}

export type PreSendDisclosureStore = StoreApi<PreSendDisclosureState>

/**
 * Builds the gate for one app, seeded with the acknowledgement `app.ts` already
 * read. Exported for tests; production code reaches it through
 * {@link preSendDisclosureStoreFor}, which memoizes per app.
 */
export const createPreSendDisclosureStore = (app: BrowserApp): PreSendDisclosureStore =>
  createStore<PreSendDisclosureState>((set, get) => {
    let nextRequestId = 1
    const disclosure = app.preSendDisclosure

    return {
      disclosure,
      acknowledgedVersion: app.preSendDisclosureAcknowledged,
      pending: null,
      lastAccepted: null,

      isRequired: () => {
        const state = get()
        if (!state.disclosure) return false
        return state.acknowledgedVersion !== state.disclosure.version
      },

      request: (prompt) => {
        const requestId = nextRequestId
        nextRequestId += 1
        set({ pending: { requestId, prompt } })
        return requestId
      },

      accept: async () => {
        const state = get()
        const pending = state.pending
        if (!state.disclosure || !pending) return
        const { version } = state.disclosure
        await app.shell.preferences.set(PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY, version).catch(() => {
          // A failed write means the reader is asked again next session. The
          // send they just approved still proceeds — refusing it would punish
          // them for a storage error they cannot act on.
        })
        // Kept on the app too, so a store rebuilt after this one is discarded
        // does not re-prompt within the same session.
        app.preSendDisclosureAcknowledged = version
        set({ acknowledgedVersion: version, pending: null, lastAccepted: pending.requestId })
      },

      dismiss: () => {
        set({ pending: null })
      }
    }
  })

// Keyed on the app object rather than a module-level singleton, because a
// document can host several `BrowserApp`s (the docs assistant beside its live
// labs) and each answers this question for itself. A `WeakMap` so a discarded app
// takes its gate with it.
const stores = new WeakMap<BrowserApp, PreSendDisclosureStore>()

export const preSendDisclosureStoreFor = (app: BrowserApp): PreSendDisclosureStore => {
  const existing = stores.get(app)
  if (existing) return existing
  const store = createPreSendDisclosureStore(app)
  stores.set(app, store)
  return store
}

export const usePreSendDisclosureStore = <T>(selector: (state: PreSendDisclosureState) => T): T =>
  useStore(preSendDisclosureStoreFor(useBrowserApp()), selector)
