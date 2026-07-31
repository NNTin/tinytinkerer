/**
 * What a successful tool result authorizes, and what it obliges (issue #478).
 *
 * Every result here is produced by running the real #477 tools over this site's
 * real documents — see `real-tool-results.ts` for why a hand-written result
 * would defeat the purpose of testing a ledger.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CANONICAL,
  installDocumentationCorpus,
  LANDING,
  OVERSIZED,
  resetDocumentationCorpus
} from '../../docs-tools/__tests__/site-artifact-fixture'
import {
  firstAnchorOf,
  readerIsNowhere,
  readerIsOn,
  runTool,
  searchDocumentation,
  searchResponseOf,
  SITE
} from './real-tool-results'
import { buildDocumentationCitationLedger, isAuthorizedTarget } from '../citation-ledger'
import { targetToHref } from '../canonical-target'

const ledgerOf = (...results: Awaited<ReturnType<typeof runTool>>[]) =>
  buildDocumentationCitationLedger(results, SITE)

describe('the citation ledger', () => {
  beforeEach(() => {
    installDocumentationCorpus()
    searchDocumentation.mockReset()
  })
  afterEach(() => {
    resetDocumentationCorpus()
    readerIsNowhere()
  })

  it('turns a successful cross-page read into an obligation to cite that document', async () => {
    const read = await runTool('read_doc', { ref: CANONICAL.entry.ref })
    const ledger = ledgerOf(read)

    expect(ledger.obligations).toHaveLength(1)
    expect(ledger.obligations[0]?.ref).toBe(CANONICAL.entry.ref)
    expect(ledger.obligations[0]?.title).toBe(CANONICAL.entry.title)
    expect(targetToHref(ledger.obligations[0].target)).toBe(CANONICAL.entry.permalink)
  })

  it('never obliges a citation for the page the reader is already on', async () => {
    readerIsOn(LANDING)
    const current = await runTool('read_current_doc', {})
    const ledger = ledgerOf(current)

    expect(ledger.obligations).toEqual([])
    expect(ledger.searchFallback).toBeNull()
    // Still eligible: the model may link the current page if it chooses to.
    expect(ledger.eligible.map((citation) => citation.origin)).toEqual(['current'])
  })

  it('treats search results as discovery candidates, with only the top hit as a fallback', async () => {
    searchDocumentation.mockResolvedValue(searchResponseOf(CANONICAL, LANDING, OVERSIZED))
    const search = await runTool('search_docs', { query: 'packages' })
    const ledger = ledgerOf(search)

    expect(ledger.obligations).toEqual([])
    expect(ledger.eligible).toHaveLength(3)
    expect(ledger.searchFallback?.ref).toBe(CANONICAL.entry.ref)
  })

  it('keeps the first successful search as the fallback when the model searches again', async () => {
    searchDocumentation.mockResolvedValueOnce(searchResponseOf(CANONICAL))
    searchDocumentation.mockResolvedValueOnce(searchResponseOf(OVERSIZED))
    const ledger = ledgerOf(
      await runTool('search_docs', { query: 'packages' }),
      await runTool('search_docs', { query: 'plugins' })
    )

    expect(ledger.searchFallback?.ref).toBe(CANONICAL.entry.ref)
  })

  it('composes a section link only from the section a read actually returned', async () => {
    const anchor = firstAnchorOf(CANONICAL)
    const sectionRead = await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor })
    const wholeRead = await runTool('read_doc', { ref: OVERSIZED.entry.ref })

    const sectionLedger = ledgerOf(sectionRead)
    expect(targetToHref(sectionLedger.obligations[0].target)).toBe(
      `${CANONICAL.entry.permalink}#${anchor}`
    )

    // An oversized read comes back as a balanced overview of the whole page, so
    // citing one of its sections would misrepresent what the answer drew on.
    const overviewLedger = ledgerOf(wholeRead)
    expect(overviewLedger.obligations[0]?.target.anchor).toBeNull()
  })

  it('authorizes every anchor the outline proved exists, and nothing else', async () => {
    const read = await runTool('read_doc', { ref: CANONICAL.entry.ref })
    const ledger = ledgerOf(read)
    const outlineAnchor = firstAnchorOf(CANONICAL)

    expect(
      isAuthorizedTarget(ledger, {
        document: CANONICAL.entry.permalink,
        anchor: outlineAnchor
      })
    ).toBe(true)
    expect(
      isAuthorizedTarget(ledger, {
        document: CANONICAL.entry.permalink,
        anchor: 'a-heading-this-page-does-not-have'
      })
    ).toBe(false)
    // A document nobody read is not authorized just because it exists.
    expect(isAuthorizedTarget(ledger, { document: LANDING.entry.permalink, anchor: null })).toBe(
      false
    )
  })

  it('counts two anchored reads of one page as a single obligation', async () => {
    const outline = CANONICAL.artifact.outline.filter((item) => item.anchor !== null)
    const ledger = ledgerOf(
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor: outline[0].anchor }),
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor: outline[1].anchor })
    )

    expect(ledger.obligations).toHaveLength(1)
  })

  it('creates nothing from a failed call, an unknown ref, or an unparseable output', async () => {
    searchDocumentation.mockResolvedValue({
      kind: 'documentation_search_failure',
      ok: false,
      code: 'index_dev_unsupported',
      message: 'no index under docusaurus start',
      retryable: false
    })

    const ledger = ledgerOf(
      await runTool('search_docs', { query: 'packages' }),
      await runTool('read_doc', { ref: 'no/such/document' }),
      // Shape the ledger has never been told about: an output that is not a
      // documentation result at all must not become a source.
      { toolId: 'read_doc', output: { status: 'ok', doc: { permalink: '/docs/invented/' } } },
      { toolId: 'web_search', output: { results: [{ url: 'https://example.test/docs/x' }] } }
    )

    expect(ledger.obligations).toEqual([])
    expect(ledger.eligible).toEqual([])
    expect(ledger.searchFallback).toBeNull()
    expect(ledger.authorizedTargets.size).toBe(0)
  })
})
