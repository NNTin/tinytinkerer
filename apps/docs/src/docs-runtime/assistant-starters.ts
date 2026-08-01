/**
 * Which suggestions the assistant's empty conversation offers on this route
 * (issue #480).
 *
 * #479 fixed the assistant's starters as route-NEUTRAL, because they are baked
 * into the `BrowserApp` at construction and the assistant is present on search
 * results and 404s as much as on a document. This adds the other half: when — and
 * only when — #476 reports an authored current document, current-page suggestions
 * come first.
 *
 * The rule is authorship, not position. The docs landing page is authored
 * (`docs/index.mdx`), so it gets current-page suggestions; a generated category
 * index, `/search`, and a 404 do not, and neither does a route whose corpus is
 * still loading or failed to load. Nothing here may imply a current document
 * exists where `read_current_doc` would answer `not_on_doc_page` — an offered
 * "Summarize this page" that the assistant then refuses is worse than not
 * offering it.
 *
 * A pure function of the resolved state, so the rule is testable without a
 * router, a corpus, or a `BrowserApp`.
 */
import type { DocsActiveDocumentState } from '../docs-page'
import { DOCS_ASSISTANT_STARTER_PROMPTS } from './assistant-constants'

/**
 * Offered only where an authored document is the current page. Phrased about
 * "this page" deliberately: these are the questions #471 opened with, and they
 * are answerable from `read_current_doc` alone.
 */
export const DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS: readonly string[] = [
  'Summarize this page.',
  'Explain a section of this page in simple terms.'
]

/**
 * How many suggestions the widget shows. Three, so an authored route can offer
 * both current-page questions and still show that cross-page search exists —
 * the floating surface's own default of one could show neither.
 */
export const DOCS_ASSISTANT_STARTER_PROMPT_COUNT = 3

export const resolveDocsAssistantStarterPrompts = (
  active: DocsActiveDocumentState
): readonly string[] =>
  active.status === 'document'
    ? [...DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS, ...DOCS_ASSISTANT_STARTER_PROMPTS]
    : DOCS_ASSISTANT_STARTER_PROMPTS
