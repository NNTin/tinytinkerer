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
