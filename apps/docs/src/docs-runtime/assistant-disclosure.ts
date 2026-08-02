/**
 * What the documentation assistant tells a reader before its first send (issue
 * #481).
 *
 * ## The guarantee this copy has to describe accurately
 *
 * Every sentence below is a claim about the shipped implementation, so each one
 * is anchored to the code that makes it true:
 *
 * - **"only when it uses one of its documentation tools"** — the corpus artifact
 *   store (`docs-corpus/artifact-store.ts`) is reached exclusively from
 *   `read_doc`/`read_current_doc`, and the Lunr worker
 *   (`docs-search/private-worker-adapter.ts`) exclusively from `search_docs`.
 *   `packages/e2e/tests/docs/assistant-performance.e2e.ts` asserts both as
 *   network facts on the built site, which is why this can be stated as
 *   behaviour rather than intent.
 * - **"authored Markdown, not the page you are looking at"** — the whole #474
 *   corpus is built from source Markdown/MDX; nothing in `apps/docs` reads the
 *   rendered DOM, and the optional product `read_dom` plugin cannot load here at
 *   all (`docusaurus.config.ts` aliases plugin discovery to a stub).
 * - **"opening the assistant sends none of it"** — activation downloads the
 *   runtime chunk and may ask the edge which models exist; no conversation and
 *   no document content leaves the browser until a send.
 *
 * Deliberately a light module (no product-runtime import) so the copy can be
 * asserted from a test, and read by the Root-mounted host, without pulling the
 * assistant chunk.
 */
import type { PreSendDisclosure } from '@tinytinkerer/app-browser'

/**
 * Bumped only when the described data flow changes — not for wording.
 *
 * A reader who acknowledged `1` is asked again at `2`, so a bump is a decision
 * about whether the change is material to somebody who already agreed. This is
 * separate from the global privacy-policy version
 * (`PRIVACY_POLICY_VERSION`, hashed from `docs/overview/PRIVACY.md`) and from
 * telemetry consent: all three ask different questions, and none of them
 * substitutes for another.
 */
export const DOCS_ASSISTANT_DISCLOSURE_VERSION = '1'

export const DOCS_ASSISTANT_DISCLOSURE_TITLE = 'Before you send this'

/**
 * The single content source. The one-time gate and the permanent
 * Settings → Privacy entry both render this array, so the two can never drift
 * into telling a reader two different things.
 */
export const DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS: readonly string[] = [
  'Your message and this conversation are sent to the model backend selected in Settings, through the TinyTinkerer edge and its LiteLLM proxy, to generate an answer.',
  'The assistant can also send the source Markdown of documentation pages — but only when it uses one of its documentation tools to search or read one. It reads the authored Markdown, never the page you are currently looking at, your form input, a live lab, or anything else in your browser.',
  'Reading documentation or opening this assistant sends none of that. Nothing leaves your browser until you send a message.',
  'Signing in is optional. Without it you share an anonymous, rate-limited quota with everyone else; signing in gives you your own budget and rate limits.'
]

export const DOCS_ASSISTANT_DISCLOSURE: PreSendDisclosure = {
  version: DOCS_ASSISTANT_DISCLOSURE_VERSION,
  title: DOCS_ASSISTANT_DISCLOSURE_TITLE,
  paragraphs: DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS,
  // The generated policy (`docs/overview/PRIVACY.md`) carries the full data-flow
  // detail this summary compresses, including the "Documentation assistant"
  // section added for this issue. Opened in place, so the message the reader
  // already typed survives reading it.
  learnMore: { label: 'Read the privacy policy', target: 'privacy-policy' },
  // "Send" rather than "Accept": the reader pressed send, this explains what
  // that does, and the button completes the thing they were already doing.
  acceptLabel: 'Send',
  // Not "Cancel" — nothing is cancelled. The message stays in the composer.
  cancelLabel: 'Not now'
}
