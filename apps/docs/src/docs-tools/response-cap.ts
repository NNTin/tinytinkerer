/**
 * The hard ceiling every documentation tool response is fitted to.
 *
 * #477 requires that no read or search response exceed the enforced output
 * limit, "even if a caller supplies a larger `maxChars`". That limit is not a
 * number this issue invents: `clampChatMessageContent` drops the tail of any
 * outgoing chat message longer than `MAX_CHAT_MESSAGE_CONTENT_CHARS`, tool
 * results included, and replaces it with a truncation notice. A response that
 * overran it would therefore be cut by the transport rather than by the
 * selection logic — severing the outline and truncation metadata from the
 * Markdown they describe, which is precisely the silent, unreportable
 * truncation #474's bounded-read contract exists to prevent.
 *
 * The measurement is on the **serialized** payload, not on Markdown length,
 * because JSON escaping is not free: on this site's real documents 19,588
 * characters of Markdown serialize to 23,456 (a ratio of 1.13–1.20, higher for
 * code-heavy pages). A character count of the Markdown alone is not a safe
 * proxy for what actually goes on the wire.
 */
// Through the documentation facade, not the app-browser barrel: the barrel
// reaches `virtual:pwa-register`, which only a Vite app build provides, so a
// value import of it cannot be loaded outside one.
import { MAX_CHAT_MESSAGE_CONTENT_CHARS } from '@tinytinkerer/app-browser/documentation-corpus'

/**
 * Headroom below the transport limit. The tool message content is exactly this
 * JSON today (`serializeToolResult` in app-browser's tool-calling.ts), so the
 * measurement is exact and the margin is pure insurance against a future
 * wrapper — not a fudge factor the selection logic relies on.
 */
const RESPONSE_CAP_HEADROOM = 1_000

export const RESPONSE_CHARACTER_CAP = MAX_CHAT_MESSAGE_CONTENT_CHARS - RESPONSE_CAP_HEADROOM

/** How the payload is measured: exactly how the runtime will serialize it. */
export const serializedLength = (value: unknown): number => (JSON.stringify(value) ?? '').length

/**
 * The longest a free-form message may be inside a response.
 *
 * Failure messages quote model-supplied identifiers and upstream error text,
 * neither of which this code chose the length of. Bounding the message is what
 * lets a typed failure stay parseable rather than being cut mid-JSON by the
 * transport.
 */
const MAX_MESSAGE_CHARS = 2_000

/**
 * The longest route a response echoes back. A pathname is whatever the SPA was
 * navigated to, so it is caller-controlled in the same way a `ref` is; a valid
 * 40,000-character route produced a `not_on_doc_page` of 42,057 characters.
 */
const MAX_PATHNAME_CHARS = 1_000

/** Bounds text, marking the cut so a reader is not misled by the tail. */
const boundedText = (value: string, limit: number): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`

/** Bounds a message, marking the cut so a reader is not misled by the tail. */
export const boundedMessage = (message: string): string => boundedText(message, MAX_MESSAGE_CHARS)

/** Bounds a route echoed back to the model. */
export const boundedPathname = (pathname: string): string =>
  boundedText(pathname, MAX_PATHNAME_CHARS)

/**
 * The single postcondition every documentation-tool response passes through.
 *
 * Field-by-field bounds are the fix for the cases we know about; this is the
 * one that holds for the cases we do not. Some parts of a response are neither
 * caller-controlled nor shrinkable — a document's `title` and `permalink` come
 * from a *validated* corpus, so a 16,000-character authored title produced a
 * 32,394-character `ok` payload even after its Markdown had been reduced to
 * nothing. Shrinking cannot fix that, and emitting it would hand the model a
 * fragment of JSON, so the response becomes a small typed failure instead.
 *
 * `overflow` must build its result from constants, since nothing downstream
 * checks it again.
 */
export const enforceResponseCap = <T>(payload: T, overflow: (length: number) => T): T =>
  serializedLength(payload) <= RESPONSE_CHARACTER_CAP
    ? payload
    : overflow(serializedLength(payload))

/** Below this there is no point shrinking further; the guard below takes over. */
const MIN_BUDGET = 500

/** Bounded, because each attempt re-runs selection over the whole document. */
const MAX_ATTEMPTS = 6

/**
 * Rebuilds `build(budget)` with a shrinking character budget until the
 * serialized result fits the cap.
 *
 * Each attempt scales the budget by how far over the cap the last one was, with
 * a little extra taken off so a payload that is barely over does not need a long
 * sequence of near-identical attempts.
 *
 * Returns the last value built even if it still does not fit — a payload whose
 * *fixed* parts (identity, outline, metadata) already exceed the cap cannot be
 * fixed by shrinking Markdown, and the caller applies its own last-resort guard.
 */
export const fitToResponseCap = <T>(build: (budget: number) => T, initialBudget: number): T => {
  let budget = initialBudget
  let value = build(budget)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const length = serializedLength(value)
    if (length <= RESPONSE_CHARACTER_CAP) return value
    if (budget <= MIN_BUDGET) return value

    const scaled = Math.floor(budget * (RESPONSE_CHARACTER_CAP / length) * 0.95)
    const next = Math.max(MIN_BUDGET, Math.min(scaled, budget - 1))
    if (next === budget) return value
    budget = next
    value = build(budget)
  }

  return value
}
