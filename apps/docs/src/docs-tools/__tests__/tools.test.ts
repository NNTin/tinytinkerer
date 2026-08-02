/**
 * The `Documentation` tool group as a public contract: the shape the tool
 * picker and the runtime consume, and `search_docs`' mapping of #475's
 * retrieval API onto it.
 *
 * Host *rendering* of an app tool group — the checkbox tree, per-tool
 * disablement, the 'none' tri-state — is already covered generically by
 * `packages/app/app-browser/tests/tool-tree.test.tsx`, which cannot import an
 * app. What this suite pins is the half that lives here: that the group
 * satisfies everything `useToolTree` and `ToolRegistry` require of it. The tools
 * become visible in a real picker in #479, which mounts the assistant session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appToolCatalogue } from '@tinytinkerer/app-browser'
import type { DocumentationSearchResponse } from '@tinytinkerer/app-browser'

const searchDocumentation = vi.fn<(...args: unknown[]) => Promise<DocumentationSearchResponse>>()
vi.mock('../../docs-search/search-documentation', () => ({
  searchDocumentation: (...args: unknown[]) => searchDocumentation(...args)
}))

// Imported through the package's public surface — the very entry point #479
// consumes — so this suite fails if that surface stops exporting what it needs.
const {
  createDocumentationToolGroup,
  DOCUMENTATION_TOOL_GROUP_ID,
  READ_CURRENT_DOC_TOOL_ID,
  READ_DOC_TOOL_ID,
  SEARCH_DOCS_TOOL_ID
} = await import('../index')
const {
  searchDocsInputSchema,
  searchDocsOutputSchema,
  readDocInputSchema,
  readCurrentDocInputSchema
} = await import('../schemas')
const { RESPONSE_CHARACTER_CAP, serializedLength } = await import('../response-cap')

const group = () =>
  createDocumentationToolGroup({
    getSiteConfig: () => ({ baseUrl: '/docs/', trailingSlash: true })
  })

const tool = (id: string) => {
  const found = appToolCatalogue(group()).find((candidate) => candidate.id === id)
  if (!found) throw new Error(`tool ${id} missing`)
  return found
}

const searchResult = (overrides: Record<string, unknown> = {}) => ({
  ref: 'architecture/packages-concept',
  title: 'Packages Concept',
  permalink: '/docs/architecture/packages-concept/',
  anchor: 'dependency-rules',
  section: 'Dependency rules',
  snippet: 'Packages may depend only on…',
  ...overrides
})

describe('the Documentation tool group', () => {
  it('is one app tool group with the three locked tools', () => {
    const value = group()
    expect(value.id).toBe(DOCUMENTATION_TOOL_GROUP_ID)
    expect(value.label).toBe('Documentation')
    // Both the literal ids the locked issue names and the constants #479 will
    // address them by, so neither can drift from the other.
    expect(appToolCatalogue(value).map((item) => item.id)).toEqual([
      'search_docs',
      'read_doc',
      'read_current_doc'
    ])
    expect([SEARCH_DOCS_TOOL_ID, READ_DOC_TOOL_ID, READ_CURRENT_DOC_TOOL_ID]).toEqual(
      appToolCatalogue(value).map((item) => item.id)
    )
  })

  it('gives every tool what the runtime and the picker require of it', () => {
    for (const item of appToolCatalogue(group())) {
      // The picker lists tools by id and renders `description`; the runtime
      // parses arguments with `schema` and *enforces* `outputSchema`.
      expect(item.id).toMatch(/^[a-z_]+$/)
      expect(item.description.length).toBeGreaterThan(40)
      expect(item.schema).toBeDefined()
      expect(item.outputSchema).toBeDefined()
      expect(typeof item.summarizeActivity).toBe('function')
      // Not a human-in-the-loop tool: it must keep the machine timeout budget.
      expect(item.awaitsHumanInput).toBeUndefined()
    }
  })

  it('has unique tool ids, which a runtime registry requires', () => {
    const ids = appToolCatalogue(group()).map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('can be created more than once without sharing mutable state', () => {
    expect(appToolCatalogue(createDocumentationToolGroup())[0]).not.toBe(
      appToolCatalogue(createDocumentationToolGroup())[0]
    )
  })
})

describe('input schemas', () => {
  it('rejects a query outside the locked bounds and trims it', () => {
    expect(searchDocsInputSchema.safeParse({ query: 'a' }).success).toBe(false)
    expect(searchDocsInputSchema.safeParse({ query: 'x'.repeat(501) }).success).toBe(false)
    expect(searchDocsInputSchema.parse({ query: '  packages  ' }).query).toBe('packages')
  })

  it('defaults and bounds maxResults to the locked range', () => {
    expect(searchDocsInputSchema.parse({ query: 'packages' }).maxResults).toBe(5)
    expect(searchDocsInputSchema.safeParse({ query: 'packages', maxResults: 11 }).success).toBe(
      false
    )
    expect(searchDocsInputSchema.safeParse({ query: 'packages', maxResults: 0 }).success).toBe(
      false
    )
  })

  it('rejects unknown keys rather than ignoring them', () => {
    expect(searchDocsInputSchema.safeParse({ query: 'packages', limit: 3 }).success).toBe(false)
    expect(readDocInputSchema.safeParse({ ref: 'a', url: 'https://x' }).success).toBe(false)
    expect(readCurrentDocInputSchema.safeParse({ maxChars: 10, ref: 'a' }).success).toBe(false)
  })

  it('accepts a large maxChars, which the tool clamps rather than rejects', () => {
    expect(readDocInputSchema.safeParse({ ref: 'a', maxChars: 10_000_000 }).success).toBe(true)
    expect(readDocInputSchema.safeParse({ ref: 'a', maxChars: 0 }).success).toBe(false)
  })

  it('has no input by which a caller could name a URL to fetch', () => {
    expect(Object.keys(readDocInputSchema.shape)).toEqual(['ref', 'anchor', 'maxChars'])
    expect(Object.keys(readCurrentDocInputSchema.shape)).toEqual(['anchor', 'maxChars'])
  })
})

describe('search_docs', () => {
  beforeEach(() => {
    searchDocumentation.mockReset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const run = async (input: Record<string, unknown>) => {
    const output = await tool('search_docs').execute(searchDocsInputSchema.parse(input))
    const parsed = searchDocsOutputSchema.safeParse(output)
    expect(parsed.error?.message ?? 'ok').toBe('ok')
    return output as import('../schemas').SearchDocsOutput
  }

  it('returns unique pages with a ref that read_doc accepts', async () => {
    searchDocumentation.mockResolvedValue({
      ok: true,
      query: 'packages',
      results: [
        searchResult(),
        searchResult({ ref: 'architecture/ARCHITECTURE', title: 'Architecture' })
      ]
    })

    const output = await run({ query: 'packages' })
    expect(output).toMatchObject({ status: 'ok', query: 'packages' })
    if (output.status !== 'ok') return
    expect(output.results.map((item) => item.ref)).toEqual([
      'architecture/packages-concept',
      'architecture/ARCHITECTURE'
    ])
    expect(output.results[0]).toMatchObject({
      permalink: '/docs/architecture/packages-concept/',
      anchor: 'dependency-rules',
      section: 'Dependency rules'
    })
  })

  it('omits section and anchor rather than reporting them as null', async () => {
    searchDocumentation.mockResolvedValue({
      ok: true,
      query: 'packages',
      results: [searchResult({ anchor: null, section: null })]
    })

    const output = await run({ query: 'packages' })
    if (output.status !== 'ok') return
    expect(output.results[0]).not.toHaveProperty('anchor')
    expect(output.results[0]).not.toHaveProperty('section')
  })

  it('reports a legitimate zero-result search as success', async () => {
    searchDocumentation.mockResolvedValue({ ok: true, query: 'zzzz', results: [] })

    expect(await run({ query: 'zzzz' })).toEqual({ status: 'ok', query: 'zzzz', results: [] })
  })

  it.each([
    ['index_dev_unsupported', false],
    ['index_unavailable', true],
    ['index_incompatible', false],
    ['manifest_unavailable', true],
    ['manifest_incompatible', false]
  ] as const)('forwards the %s failure code verbatim', async (code, retryable) => {
    searchDocumentation.mockResolvedValue({
      ok: false,
      kind: 'documentation_search_failure',
      code,
      message: `retrieval failed: ${code}`,
      retryable
    })

    const output = await run({ query: 'packages' })
    expect(output).toEqual({
      status: 'search_unavailable',
      code,
      message: `retrieval failed: ${code}`,
      retryable
    })
  })

  it('passes the requested maximum through to retrieval', async () => {
    searchDocumentation.mockResolvedValue({ ok: true, query: 'packages', results: [] })
    await run({ query: 'packages', maxResults: 3 })

    expect(searchDocumentation).toHaveBeenCalledWith(
      { baseUrl: '/docs/', trailingSlash: true },
      'packages',
      3
    )
  })

  it('keeps an oversized result set inside the enforced output limit', async () => {
    searchDocumentation.mockResolvedValue({
      ok: true,
      query: 'packages',
      // Far beyond anything #475 produces, so the bound is proven rather than
      // assumed from the usual result sizes.
      results: Array.from({ length: 200 }, (_, index) =>
        searchResult({ ref: `ref-${index}`, snippet: 'x'.repeat(3_000) })
      )
    })

    const output = await run({ query: 'packages' })
    expect(serializedLength(output)).toBeLessThanOrEqual(RESPONSE_CHARACTER_CAP)
  })
})
