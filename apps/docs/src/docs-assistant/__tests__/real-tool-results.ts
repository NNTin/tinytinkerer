/**
 * Tool results for the citation tests, produced by **running the real #477
 * tools** against this site's real corpus.
 *
 * The #476 review's most generalizable finding was that a fictional corpus
 * cannot disagree with reality. A ledger is exactly the kind of code that would
 * hide behind hand-written fixtures: it exists to trust nothing but a typed
 * successful result, so a test that hand-writes those results is testing the
 * test's idea of the contract rather than the contract. Here the outputs come
 * out of `createDocumentationToolGroup()` — the same objects the runtime
 * registers — reading `docs/architecture/packages-concept.md` and friends
 * through `docs-tools/__tests__/site-artifact-fixture.ts`.
 *
 * Retrieval is the one exception. #475's adapter runs a private Lunr worker over
 * an index only a production build writes, so `search_docs` is driven with its
 * upstream response mocked — but the refs, titles, permalinks, and anchors in
 * that response are the real ones, taken from the same site fixtures.
 */
import { vi } from 'vitest'
import type { DocumentationSearchResponse } from '@tinytinkerer/app-browser'
import type { AppToolResultRecord } from '@tinytinkerer/app-browser'
import {
  SITE_CONFIG,
  type SiteDocumentFixture
} from '../../docs-tools/__tests__/site-artifact-fixture'
import {
  publishDocsPageSnapshot,
  resetDocsPageSnapshotForTests
} from '../../docs-page/page-snapshot'
import type { DocumentationSite } from '../canonical-target'

export const SITE: DocumentationSite = {
  siteConfig: SITE_CONFIG,
  origin: 'https://tinytinkerer.example'
}

export const searchDocumentation =
  vi.fn<(...args: unknown[]) => Promise<DocumentationSearchResponse>>()

vi.mock('../../docs-search/search-documentation', () => ({
  searchDocumentation: (...args: unknown[]) => searchDocumentation(...args)
}))

const { createDocumentationToolGroup } = await import('../../docs-tools')

const toolById = new Map(
  createDocumentationToolGroup({ getSiteConfig: () => SITE_CONFIG }).tools.map((tool) => [
    tool.id,
    tool
  ])
)

/**
 * The provenance `create-runtime` stamps on a tool it registers from the
 * `Documentation` app group. Written out rather than imported so a change to
 * what the host stamps has to be reflected here deliberately.
 */
export const DOCUMENTATION_SOURCE = { kind: 'app', groupId: 'documentation' } as const

/** Runs a real documentation tool and returns the record a policy would see. */
export const runTool = async (
  toolId: string,
  input: Record<string, unknown>
): Promise<AppToolResultRecord> => {
  const tool = toolById.get(toolId)
  if (!tool) throw new Error(`tool ${toolId} missing`)
  const output = await tool.execute(tool.schema.parse(input))
  return { toolId, output, source: DOCUMENTATION_SOURCE }
}

/**
 * Puts the reader on a real authored route, the way #476's Root provider does,
 * so `read_current_doc` resolves a current document instead of reporting none.
 */
export const readerIsOn = (fixture: SiteDocumentFixture): void => {
  publishDocsPageSnapshot({
    pathname: fixture.entry.permalink,
    siteConfig: SITE_CONFIG,
    retryCorpus: () => {},
    active: {
      status: 'document',
      document: {
        ref: fixture.entry.ref,
        version: fixture.entry.version,
        isLast: fixture.entry.isLast,
        title: fixture.entry.title,
        permalink: fixture.entry.permalink,
        unlisted: fixture.entry.unlisted
      }
    }
  })
}

export const readerIsNowhere = resetDocsPageSnapshotForTests

/** The first heading anchor of a real site document, for anchored-read cases. */
export const firstAnchorOf = (fixture: SiteDocumentFixture): string => {
  const anchor = fixture.artifact.outline.find((item) => item.anchor !== null)?.anchor
  if (!anchor) throw new Error(`${fixture.entry.ref} has no anchored heading`)
  return anchor
}

/**
 * A `search_docs` upstream response built from real documents. `anchor`/
 * `section` are `null`-carrying per #475's contract; the tool is what turns them
 * into omitted keys.
 */
export const searchResponseOf = (
  ...fixtures: readonly SiteDocumentFixture[]
): DocumentationSearchResponse => ({
  ok: true,
  query: 'packages',
  results: fixtures.map((fixture) => ({
    ref: fixture.entry.ref,
    title: fixture.entry.title,
    permalink: fixture.entry.permalink,
    anchor: null,
    section: null,
    snippet: `a real snippet from ${fixture.entry.ref}`
  }))
})
