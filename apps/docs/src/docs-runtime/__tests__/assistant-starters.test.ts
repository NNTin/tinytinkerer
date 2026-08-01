/**
 * Route-aware suggestions (issue #480).
 *
 * The rule is authorship, not position — the same line #476 draws. A suggestion
 * that says "this page" where `read_current_doc` would answer `not_on_doc_page`
 * is worse than not offering one: the assistant would refuse the very question it
 * just proposed.
 */
import { describe, expect, it } from 'vitest'
import type { DocsActiveDocumentState, DocsNoActiveDocumentReason } from '../../docs-page'
import { DOCS_ASSISTANT_STARTER_PROMPTS } from '../assistant-constants'
import {
  DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS,
  DOCS_ASSISTANT_STARTER_PROMPT_COUNT,
  resolveDocsAssistantStarterPrompts
} from '../assistant-starters'

const onDocument = (unlisted = false): DocsActiveDocumentState => ({
  status: 'document',
  document: {
    ref: 'architecture/packages-concept',
    version: 'current',
    isLast: true,
    title: 'Packages concept',
    permalink: '/docs/architecture/packages-concept/',
    unlisted
  }
})

const noDocument = (reason: DocsNoActiveDocumentReason): DocsActiveDocumentState => ({
  status: 'no-document',
  reason,
  message: 'no current document',
  retryable: false
})

describe('on an authored document', () => {
  it('offers current-page suggestions first, then the route-neutral ones', () => {
    expect(resolveDocsAssistantStarterPrompts(onDocument())).toEqual([
      ...DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS,
      ...DOCS_ASSISTANT_STARTER_PROMPTS
    ])
  })

  it('offers them on a direct visit to an unlisted document too', () => {
    // Unlisted means "not discoverable by global search", not "not a page".
    expect(resolveDocsAssistantStarterPrompts(onDocument(true))[0]).toBe(
      DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS[0]
    )
  })

  it('shows both current-page suggestions and still admits cross-page questions', () => {
    // The floating surface's own default of one suggestion could show neither
    // half of that; three is what makes the pair plus a cross-page prompt fit.
    const shown = resolveDocsAssistantStarterPrompts(onDocument()).slice(
      0,
      DOCS_ASSISTANT_STARTER_PROMPT_COUNT
    )
    expect(shown).toHaveLength(3)
    expect(shown).toEqual(expect.arrayContaining([...DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS]))
    expect(shown.at(-1)).toBe(DOCS_ASSISTANT_STARTER_PROMPTS[0])
  })
})

describe('everywhere else', () => {
  const reasons: DocsNoActiveDocumentReason[] = [
    // /search and 404 routes.
    'not_a_document_route',
    // A Docusaurus-generated category index; nobody authored it.
    'generated_index_route',
    // The corpus has not arrived, or never will.
    'corpus_pending',
    'corpus_unavailable',
    'corpus_incompatible',
    'unknown_active_document'
  ]

  it.each(reasons)('offers route-neutral suggestions only for %s', (reason) => {
    const prompts = resolveDocsAssistantStarterPrompts(noDocument(reason))

    expect(prompts).toEqual(DOCS_ASSISTANT_STARTER_PROMPTS)
    // Nothing may imply a current document exists.
    for (const currentPage of DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS) {
      expect(prompts).not.toContain(currentPage)
    }
    expect(prompts.some((prompt) => /this page|this section/i.test(prompt))).toBe(false)
  })
})
