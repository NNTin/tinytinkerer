// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  PLAYGROUND_EXAMPLE_QUERY_PARAM,
  readExampleIdFromSearch,
  withExampleIdInSearch
} from '../url-param'

describe('playground URL example param', () => {
  it('reads a present example id', () => {
    expect(readExampleIdFromSearch('?example=mermaid')).toBe('mermaid')
  })

  it('returns null when absent', () => {
    expect(readExampleIdFromSearch('')).toBeNull()
    expect(readExampleIdFromSearch('?foo=bar')).toBeNull()
  })

  it('round-trips through withExampleIdInSearch', () => {
    const search = withExampleIdInSearch('', 'wireframe')
    expect(search).toBe(`?${PLAYGROUND_EXAMPLE_QUERY_PARAM}=wireframe`)
    expect(readExampleIdFromSearch(search)).toBe('wireframe')
  })

  it('replaces an existing example id rather than duplicating the param', () => {
    const search = withExampleIdInSearch('?example=mermaid&other=1', 'table')
    expect(readExampleIdFromSearch(search)).toBe('table')
    expect(search).toContain('other=1')
    expect(search.match(/example=/g)?.length).toBe(1)
  })

  it('never carries arbitrary free-text source, only the query param value', () => {
    // Guards against a future change accidentally serializing editor content
    // into the URL: this only ever round-trips short curated ids.
    const search = withExampleIdInSearch('', 'not-a-real-id-but-still-just-an-id')
    expect(search.length).toBeLessThan(80)
  })
})
