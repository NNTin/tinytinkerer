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

  it('authorizes the section a read selected, and no other heading of that page', async () => {
    const anchor = firstAnchorOf(CANONICAL)
    const ledger = ledgerOf(await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor }))
    const otherAnchor = CANONICAL.artifact.outline.find(
      (item) => item.anchor !== null && item.anchor !== anchor
    )?.anchor

    const authorizes = (value: string | null) =>
      isAuthorizedTarget(ledger, { document: CANONICAL.entry.permalink, anchor: value })

    expect(authorizes(anchor)).toBe(true)
    // The page itself: citing the document rather than the heading is citing
    // something the result returned.
    expect(authorizes(null)).toBe(true)
    // An outline entry proves a heading EXISTS; it does not prove the answer
    // drew on it, so it is not a target this turn can cite.
    expect(otherAnchor).toBeDefined()
    expect(authorizes(otherAnchor!)).toBe(false)
    expect(authorizes('a-heading-this-page-does-not-have')).toBe(false)
    // A document nobody read is not authorized just because it exists.
    expect(isAuthorizedTarget(ledger, { document: LANDING.entry.permalink, anchor: null })).toBe(
      false
    )
  })

  it('does not authorize any section of a page read whole', async () => {
    const ledger = ledgerOf(await runTool('read_doc', { ref: CANONICAL.entry.ref }))

    expect(isAuthorizedTarget(ledger, { document: CANONICAL.entry.permalink, anchor: null })).toBe(
      true
    )
    expect(
      isAuthorizedTarget(ledger, {
        document: CANONICAL.entry.permalink,
        anchor: firstAnchorOf(CANONICAL)
      })
    ).toBe(false)
  })

  it('counts two anchored reads of one page as a single, document-level obligation', async () => {
    const outline = CANONICAL.artifact.outline.filter((item) => item.anchor !== null)
    const ledger = ledgerOf(
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor: outline[0].anchor }),
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor: outline[1].anchor })
    )

    expect(ledger.obligations).toHaveLength(1)
    // The evidence spans more of the page than either section link would claim.
    expect(ledger.obligations[0].target.anchor).toBeNull()
    // Both sections the turn actually selected stay citable.
    for (const entry of outline.slice(0, 2)) {
      expect(
        isAuthorizedTarget(ledger, {
          document: CANONICAL.entry.permalink,
          anchor: entry.anchor
        })
      ).toBe(true)
    }
  })

  it('generates the same citation whichever order the reads happened in', async () => {
    const anchor = firstAnchorOf(CANONICAL)
    const wholeThenSection = ledgerOf(
      await runTool('read_doc', { ref: CANONICAL.entry.ref }),
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor })
    )
    const sectionThenWhole = ledgerOf(
      await runTool('read_doc', { ref: CANONICAL.entry.ref, anchor }),
      await runTool('read_doc', { ref: CANONICAL.entry.ref })
    )

    // Identical evidence, so an identical citation: the page, because the turn
    // saw the whole of it either way.
    expect(wholeThenSection.obligations[0].target).toEqual(sectionThenWhole.obligations[0].target)
    expect(wholeThenSection.obligations[0].target.anchor).toBeNull()
  })

  it('trusts only a result the host attributed to the documentation tool group', async () => {
    const real = await runTool('read_doc', { ref: CANONICAL.entry.ref })

    // A plugin that claimed the `read_doc` id and answers in a schema-compatible
    // shape. `create-runtime` lets a colliding plugin win the id, so this is a
    // reachable state rather than a hypothetical one — and the shape alone must
    // not buy it any trust.
    const impostor = { ...real, source: { kind: 'plugin' as const } }
    const unattributed = { toolId: real.toolId, output: real.output }

    for (const untrusted of [impostor, unattributed]) {
      const ledger = buildDocumentationCitationLedger([untrusted], SITE)
      expect(ledger.obligations).toEqual([])
      expect(ledger.eligible).toEqual([])
      expect(ledger.authorizedTargets.size).toBe(0)
    }

    // The genuine one still works, so this is a provenance check rather than a
    // schema regression.
    expect(ledgerOf(real).obligations).toHaveLength(1)
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
