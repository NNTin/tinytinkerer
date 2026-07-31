/**
 * The response-size postcondition, checked over **every** public variant of
 * every documentation tool rather than over the cases someone remembered.
 *
 * #477 makes the limit absolute, and the previous review round showed why a
 * field-by-field defence is not enough on its own: bounding `ref` and `anchor`
 * left `pathname` unbounded (a valid 40,000-character SPA route serialized to
 * 42,057 characters), and no amount of shrinking Markdown can rescue a payload
 * whose *fixed* metadata is already too large — a validated corpus document with
 * a 16,000-character authored title produced a 32,394-character `ok` after its
 * Markdown had been reduced to nothing.
 *
 * So the property under test is stated once, over the whole surface: whatever a
 * tool returns, it parses against its own output schema and fits the cap. The
 * variant-coverage assertion at the end is what stops this from quietly
 * becoming a partial sweep as #478/#479 add statuses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tool } from '@tinytinkerer/app-browser'
import type { DocumentationSearchResponse } from '@tinytinkerer/app-browser'
import {
  publishDocsPageSnapshot,
  resetDocsPageSnapshotForTests
} from '../../docs-page/page-snapshot'
import { createDocumentationToolGroup } from '../index'
import { readCurrentDocOutputSchema, readDocOutputSchema, searchDocsOutputSchema } from '../schemas'
import { RESPONSE_CHARACTER_CAP, serializedLength } from '../response-cap'
import {
  CANONICAL,
  installDocumentationCorpus,
  LANDING,
  OVERSIZED,
  resetDocumentationCorpus,
  SITE_CONFIG
} from './site-artifact-fixture'

const searchDocumentation = vi.fn<(...args: unknown[]) => Promise<DocumentationSearchResponse>>()
vi.mock('../../docs-search/search-documentation', () => ({
  searchDocumentation: (...args: unknown[]) => searchDocumentation(...args)
}))

const toolNamed = (id: string): Tool<unknown, unknown> => {
  const found = createDocumentationToolGroup().tools.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`tool ${id} missing`)
  return found
}

/** A route long enough to have overrun the cap on its own. */
const HUGE_PATHNAME = `/docs/${'p'.repeat(40_000)}/`

const documentRoute = (pathname: string) => ({
  pathname,
  siteConfig: SITE_CONFIG,
  retryCorpus: () => {},
  active: {
    status: 'document' as const,
    document: {
      ref: CANONICAL.entry.ref,
      version: CANONICAL.entry.version,
      isLast: true,
      title: CANONICAL.entry.title,
      permalink: CANONICAL.entry.permalink,
      unlisted: false
    }
  }
})

const noDocumentRoute = (
  reason: 'not_a_document_route' | 'corpus_unavailable',
  pathname: string
) => ({
  pathname,
  siteConfig: SITE_CONFIG,
  retryCorpus: () => {},
  active: {
    status: 'no-document' as const,
    reason,
    message: `no current document: ${'m'.repeat(50_000)}`,
    retryable: false
  }
})

/**
 * A *valid* corpus whose manifest records an enormous authored title.
 *
 * Nothing here is malformed: the artifact, its bytes, and every hash agree, so
 * the corpus passes every integrity and semantic check. That is the point —
 * the oversized part is metadata a read has no way to shrink.
 */
const hugeTitle = (length: number) => ({
  ...CANONICAL,
  entry: { ...CANONICAL.entry, title: 'T'.repeat(length) }
})

type Scenario = {
  name: string
  tool: 'search_docs' | 'read_doc' | 'read_current_doc'
  input: Record<string, unknown>
  setup: () => unknown
}

const searchResults = (count: number, snippetLength: number): DocumentationSearchResponse => ({
  ok: true,
  query: 'q'.repeat(500),
  results: Array.from({ length: count }, (_, index) => ({
    ref: `architecture/packages-concept-${index}`,
    title: 'T'.repeat(2_000),
    permalink: `/docs/architecture/packages-concept-${index}/`,
    section: 'S'.repeat(2_000),
    anchor: `a${index}`,
    snippet: 's'.repeat(snippetLength)
  }))
})

const SCENARIOS: Scenario[] = [
  {
    name: 'search_docs ok',
    tool: 'search_docs',
    input: { query: 'packages', maxResults: 5 },
    setup: () => {
      searchDocumentation.mockResolvedValue(searchResults(5, 400))
    }
  },
  {
    name: 'search_docs ok with pathologically large results',
    tool: 'search_docs',
    input: { query: 'q'.repeat(500), maxResults: 10 },
    setup: () => {
      searchDocumentation.mockResolvedValue(searchResults(10, 20_000))
    }
  },
  {
    name: 'search_docs unavailable with an upstream message',
    tool: 'search_docs',
    input: { query: 'packages' },
    setup: () => {
      searchDocumentation.mockResolvedValue({
        ok: false,
        kind: 'documentation_search_failure',
        code: 'index_unavailable',
        message: 'u'.repeat(60_000),
        retryable: true
      })
    }
  },
  {
    name: 'read_doc ok',
    tool: 'read_doc',
    input: { ref: CANONICAL.entry.ref },
    setup: () => installDocumentationCorpus()
  },
  {
    name: 'read_doc ok as a balanced overview',
    tool: 'read_doc',
    input: { ref: OVERSIZED.entry.ref, maxChars: 999_999 },
    setup: () => installDocumentationCorpus()
  },
  {
    name: 'read_doc document_not_found for a huge ref',
    tool: 'read_doc',
    input: { ref: 'x'.repeat(300) },
    setup: () => installDocumentationCorpus()
  },
  {
    name: 'read_doc section_not_found for a huge anchor',
    tool: 'read_doc',
    input: { ref: OVERSIZED.entry.ref, anchor: 'y'.repeat(300) },
    setup: () => installDocumentationCorpus()
  },
  {
    name: 'read_doc document_unavailable with an upstream message',
    tool: 'read_doc',
    input: { ref: CANONICAL.entry.ref },
    setup: () =>
      installDocumentationCorpus(undefined, {
        [CANONICAL.entry.artifact]: () => Promise.reject(new Error('z'.repeat(60_000)))
      })
  },
  {
    name: 'read_doc content_hash_mismatch',
    tool: 'read_doc',
    input: { ref: CANONICAL.entry.ref },
    setup: () =>
      installDocumentationCorpus(undefined, {
        [CANONICAL.entry.artifact]: () =>
          Promise.resolve(
            new Response(
              `${JSON.stringify({ ...CANONICAL.artifact, markdown: `x\n${CANONICAL.artifact.markdown}` })}\n`,
              { status: 200 }
            )
          )
      })
  },
  {
    name: 'read_doc document_invalid',
    tool: 'read_doc',
    input: { ref: CANONICAL.entry.ref },
    setup: () => {
      installDocumentationCorpus(undefined, {
        [CANONICAL.entry.artifact]: () =>
          Promise.resolve(new Response(LANDING.bytes, { status: 200 }))
      })
      vi.stubGlobal('crypto', {})
    }
  },
  {
    name: 'read_doc manifest_unavailable with an upstream message',
    tool: 'read_doc',
    input: { ref: 'q'.repeat(300) },
    setup: () => {
      const { manifestUrl } = installDocumentationCorpus()
      installDocumentationCorpus(undefined, {
        [manifestUrl]: () => Promise.reject(new Error('m'.repeat(60_000)))
      })
    }
  },
  {
    name: 'read_doc manifest_incompatible',
    tool: 'read_doc',
    input: { ref: CANONICAL.entry.ref },
    setup: () => {
      const { manifestUrl } = installDocumentationCorpus()
      installDocumentationCorpus(undefined, {
        [manifestUrl]: () =>
          Promise.resolve(
            new Response(`${JSON.stringify({ schemaVersion: 99 })}\n`, { status: 200 })
          )
      })
    }
  },
  {
    name: 'read_doc response_too_large for irreducible metadata',
    tool: 'read_doc',
    input: { ref: CANONICAL.entry.ref },
    setup: () => installDocumentationCorpus([hugeTitle(40_000), LANDING, OVERSIZED])
  },
  {
    name: 'read_current_doc ok',
    tool: 'read_current_doc',
    input: {},
    setup: () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(documentRoute(CANONICAL.entry.permalink))
    }
  },
  {
    name: 'read_current_doc response_too_large for irreducible metadata',
    tool: 'read_current_doc',
    input: {},
    setup: () => {
      installDocumentationCorpus([hugeTitle(40_000), LANDING, OVERSIZED])
      publishDocsPageSnapshot(documentRoute(CANONICAL.entry.permalink))
    }
  },
  {
    name: 'read_current_doc not_on_doc_page with a huge route',
    tool: 'read_current_doc',
    input: {},
    setup: () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(noDocumentRoute('not_a_document_route', HUGE_PATHNAME))
    }
  },
  {
    name: 'read_current_doc unavailable with a huge route',
    tool: 'read_current_doc',
    input: {},
    setup: () => {
      installDocumentationCorpus()
      publishDocsPageSnapshot(noDocumentRoute('corpus_unavailable', HUGE_PATHNAME))
    }
  }
]

const schemaFor = {
  search_docs: searchDocsOutputSchema,
  read_doc: readDocOutputSchema,
  read_current_doc: readCurrentDocOutputSchema
}

/** How a variant is named for the coverage check: its discriminant, refined. */
const variantOf = (output: unknown): string => {
  const value = output as { status: string; code?: string; reason?: string }
  return [value.status, value.code, value.reason].filter(Boolean).join(':')
}

describe('the response-size postcondition', () => {
  const observed = new Set<string>()

  afterEach(() => {
    resetDocumentationCorpus()
    resetDocsPageSnapshotForTests()
    searchDocumentation.mockReset()
  })

  it.each(SCENARIOS)('holds for $name', async (scenario) => {
    await scenario.setup()
    const output = await toolNamed(scenario.tool).execute(scenario.input)
    observed.add(`${scenario.tool}:${variantOf(output)}`)

    // Both halves matter: a payload cut by the transport is unparseable, and a
    // payload that fits but breaks its schema is rejected by the registry.
    const parsed = schemaFor[scenario.tool].safeParse(output)
    expect(parsed.error?.message ?? 'ok').toBe('ok')
    expect(serializedLength(output)).toBeLessThanOrEqual(RESPONSE_CHARACTER_CAP)
  })

  it('was exercised over every variant these tools can return', () => {
    // The list is spelled out rather than derived, so adding a status to a
    // schema without a scenario for it fails here instead of silently narrowing
    // the sweep above.
    expect([...observed].sort()).toEqual([
      'read_current_doc:error:response_too_large',
      'read_current_doc:not_on_doc_page',
      'read_current_doc:ok',
      'read_current_doc:unavailable:corpus_unavailable',
      'read_doc:error:content_hash_mismatch',
      'read_doc:error:document_invalid',
      'read_doc:error:document_not_found',
      'read_doc:error:document_unavailable',
      'read_doc:error:manifest_incompatible',
      'read_doc:error:manifest_unavailable',
      'read_doc:error:response_too_large',
      'read_doc:error:section_not_found',
      'read_doc:ok',
      'search_docs:ok',
      'search_docs:search_unavailable:index_unavailable'
    ])
  })
})
