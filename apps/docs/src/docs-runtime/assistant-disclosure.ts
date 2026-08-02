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
 * - **"derived from the documentation's authored Markdown"** — deliberately not
 *   "the source Markdown". A read returns normalized authored Markdown; a search
 *   returns titles, headings and short excerpts out of the Lunr index. Both are
 *   derived from what a human wrote, and neither is the rendered page — but
 *   calling a search snippet "source Markdown" would be describing only half of
 *   what the tools do (issue #481 review, finding 3).
 * - **"not the page you are looking at"** — the whole #474 corpus is built from
 *   source Markdown/MDX; nothing in `apps/docs` reads the rendered DOM, and the
 *   optional product `read_dom` plugin cannot load here at all
 *   (`docusaurus.config.ts` aliases plugin discovery to a stub).
 * - **"does not send conversation or documentation content to a model"** — also
 *   deliberate, and narrower than "nothing leaves your browser", which was
 *   false: activation downloads the runtime chunk, the page fetches the corpus
 *   manifest, and the shell may ask the edge which models exist. None of that is
 *   content, and the guarantee #481 asks for is about content.
 *
 * Deliberately a light module (no product-runtime import) so the copy can be
 * asserted from a test, and read by the Root-mounted host, without pulling the
 * assistant chunk.
 */
import type { PreSendDisclosure } from '@tinytinkerer/app-browser'

/**
 * Bumped whenever what a reader is agreeing to MEANS something different.
 *
 * That includes a substantive wording correction, not only a change in the code
 * — the two are not the same thing, and treating them as the same is how an
 * acknowledgement of an inaccurate statement gets carried forward as if it were
 * an acknowledgement of the accurate one (issue #481 review, finding 3). Version
 * `2` is exactly that case: no data flow changed, but version `1` claimed
 * "nothing leaves your browser" and described every tool result as "source
 * Markdown", and a reader who agreed to those did not agree to what actually
 * happens.
 *
 * Pure copy-editing — a typo, a reflow — does not bump it.
 *
 * Separate from the global privacy-policy version (`PRIVACY_POLICY_VERSION`,
 * hashed from `docs/overview/PRIVACY.md`) and from telemetry consent: all three
 * ask different questions, and none substitutes for another.
 */
export const DOCS_ASSISTANT_DISCLOSURE_VERSION = '2'

export const DOCS_ASSISTANT_DISCLOSURE_TITLE = 'Before you send this'

/**
 * The single content source. The one-time gate and the permanent
 * Settings → Privacy entry both render this array, so the two can never drift
 * into telling a reader two different things.
 */
export const DOCS_ASSISTANT_DISCLOSURE_PARAGRAPHS: readonly string[] = [
  'Your message and this conversation are sent to the model backend selected in Settings, through the TinyTinkerer edge and its LiteLLM proxy, to generate an answer.',
  'The assistant can also send documentation content — search excerpts, or a page it reads in full — but only when it uses one of its documentation tools. That content is derived from the Markdown this documentation is written in, never from the page you are currently looking at, your form input, a live lab, or anything else in your browser.',
  'Merely reading documentation, or opening this assistant, does not send any conversation or documentation content to a model.',
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
