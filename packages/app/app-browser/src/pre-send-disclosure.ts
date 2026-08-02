/**
 * A one-time, app-scoped disclosure a reader must acknowledge before this app
 * sends its first prompt (issue #481).
 *
 * ## Why this is a `BrowserApp` capability and not a docs component
 *
 * The documentation assistant has to tell a reader, before any content reaches a
 * model, that the model receives the conversation plus whatever documentation
 * its tools chose to search or read. Three shapes were rejected:
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
  /** Identifies one attempt, so a caller can correlate its own. */
  requestId: number
  /** The trimmed prompt the reader tried to send, when a send raised this. */
  prompt: string
}

/**
 * What {@link PreSendDisclosureState.request} hands back: the id, and the
 * reader's eventual answer.
 *
 * The promise is the important half. It is what lets every prompt send — the
 * composer, Regenerate, and anything #472 adds later — wait on one decision,
 * instead of each caller re-deriving "was my attempt the one that got
 * approved?" from shared mutable state.
 */
export type PreSendDisclosureDecision = {
  requestId: number
  /** Resolves `true` when acknowledged, `false` when dismissed. */
  decided: Promise<boolean>
}

export type PreSendDisclosureState = {
  /** The configured disclosure, or `undefined` for every app without one. */
  disclosure: PreSendDisclosure | undefined
  /** The version this reader last acknowledged in this app's namespace. */
  acknowledgedVersion: string | null
  /** The attempt waiting on an answer, if the gate is open. */
  pending: PreSendDisclosureRequest | null
  /** Whether the next send must be gated. */
  isRequired: () => boolean
  /**
   * Ask for acknowledgement, and hand back the eventual answer.
   *
   * A request raised while another is already pending JOINS it rather than
   * replacing it: the disclosure is a fact about this app's data flow, not about
   * one message, so a second send does not deserve a second dialog — and
   * overwriting `pending` would have stranded the first caller's promise
   * forever.
   */
  request: (prompt: string) => PreSendDisclosureDecision
  /** Persist the acknowledgement and release everything waiting on it. */
  accept: () => Promise<void>
  /** Close the gate without acknowledging. Nothing waiting on it is sent. */
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
    // Everything waiting on the currently open dialog. A list rather than one
    // resolver because several sends can pile up behind a single question.
    let waiting: ((allowed: boolean) => void)[] = []
    const settle = (allowed: boolean) => {
      const resolvers = waiting
      waiting = []
      for (const resolve of resolvers) resolve(allowed)
    }
    const disclosure = app.preSendDisclosure

    return {
      disclosure,
      acknowledgedVersion: app.preSendDisclosureAcknowledged,
      pending: null,

      isRequired: () => {
        const state = get()
        if (!state.disclosure) return false
        return state.acknowledgedVersion !== state.disclosure.version
      },

      request: (prompt) => {
        const decided = new Promise<boolean>((resolve) => {
          waiting.push(resolve)
        })
        const existing = get().pending
        // Join the open question rather than replacing it — see the type's note.
        if (existing) return { requestId: existing.requestId, decided }
        const requestId = nextRequestId
        nextRequestId += 1
        set({ pending: { requestId, prompt } })
        return { requestId, decided }
      },

      accept: async () => {
        const state = get()
        if (!state.disclosure || !state.pending) return
        const { version } = state.disclosure
        await app.shell.preferences.set(PRE_SEND_DISCLOSURE_ACKNOWLEDGED_KEY, version).catch(() => {
          // A failed write means the reader is asked again next session. The
          // send they just approved still proceeds — refusing it would punish
          // them for a storage error they cannot act on.
        })
        // Kept on the app too, so a store rebuilt after this one is discarded
        // does not re-prompt within the same session.
        app.preSendDisclosureAcknowledged = version
        set({ acknowledgedVersion: version, pending: null })
        settle(true)
      },

      dismiss: () => {
        set({ pending: null })
        settle(false)
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

/**
 * The one coordinator every prompt send passes through.
 *
 * Resolves `true` when this app may send, `false` when the reader declined.
 * An app with no disclosure resolves `true` without touching anything.
 *
 * "Prompt send", not "network request": this gates conversation and tool
 * content on its way to a model. The app still fetches its own code, the
 * corpus manifest, and the model catalogue without consulting it — none of
 * which carry content, and none of which reach a model.
 *
 * This exists because "the composer checks the gate" was NOT the same as "the
 * app cannot send unacknowledged". `rerunLastPrompt` reaches `sendPrompt`
 * directly, so Regenerate sent a whole persisted conversation past a gate the
 * reader had never seen — and #472 would have added a third such path. The
 * check therefore lives at the chokepoint every send shares
 * (`chat-store`'s `sendPrompt`, which awaits this), with the composer
 * additionally consulting it BEFORE clearing its input so a declined send keeps
 * the reader's text.
 *
 * Consulting it twice for one composer send is free and deliberate: after the
 * first acknowledgement `isRequired()` is false, so the second consult resolves
 * immediately and no second dialog appears.
 */
export const requestOutboundSendApproval = async (
  app: BrowserApp,
  prompt: string
): Promise<boolean> => {
  const gate = preSendDisclosureStoreFor(app).getState()
  if (!gate.isRequired()) return true
  return gate.request(prompt).decided
}
