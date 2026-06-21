import {
  EDGE_ROUTE_PATHS,
  isPluginModule,
  type PluginEdgeResponse,
  type PluginHost
} from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as webSearchModule from '../src/index'
import {
  WEB_SEARCH_PLUGIN_ID,
  WebSearchSchemaError,
  summarizeWebSearchActivity,
  webSearchPlugin,
  webSearchPluginManifest
} from '../src/index'

// Minimal edge response stub mirroring the host PluginEdgeResponse surface.
const edgeResponse = (ok: boolean, status: number, body: unknown): PluginEdgeResponse => ({
  ok,
  status,
  json: () => Promise.resolve(body)
})

const hostWithEdge = (edgeFetch: NonNullable<PluginHost['edgeFetch']>): PluginHost => ({
  capture: vi.fn(),
  edgeFetch
})

describe('webSearchPlugin', () => {
  it('exposes a web-search tool when the host provides an edge capability', () => {
    const host = hostWithEdge(vi.fn())
    const tools = webSearchPlugin().createTools?.(host) ?? []
    expect(tools.map((t) => t.id)).toEqual([WEB_SEARCH_PLUGIN_ID])
  })

  it('contributes no tool when the host has no edge backend', () => {
    const host: PluginHost = { capture: vi.fn() }
    const tools = webSearchPlugin().createTools?.(host) ?? []
    expect(tools).toEqual([])
  })

  it('POSTs the search request to the edge route and returns the parsed response', async () => {
    const edgeFetch = vi.fn(() =>
      Promise.resolve(edgeResponse(true, 200, { query: 'react news', results: [] }))
    )
    const [tool] = webSearchPlugin().createTools?.(hostWithEdge(edgeFetch)) ?? []

    const result = await tool!.execute({ query: 'react news' })

    expect(edgeFetch).toHaveBeenCalledWith(
      EDGE_ROUTE_PATHS.search,
      { query: 'react news' },
      {
        area: 'search'
      }
    )
    expect(result).toEqual({ query: 'react news', results: [] })
  })

  it('surfaces the structured edge error message on a non-OK response', async () => {
    const edgeFetch = vi.fn(() =>
      Promise.resolve(edgeResponse(false, 502, { error: 'Tavily upstream failed' }))
    )
    const [tool] = webSearchPlugin().createTools?.(hostWithEdge(edgeFetch)) ?? []

    await expect(tool!.execute({ query: 'react news' })).rejects.toThrow('Tavily upstream failed')
  })

  it('falls back to a status message when the error payload is unstructured', async () => {
    const edgeFetch = vi.fn(() => Promise.resolve(edgeResponse(false, 500, 'oops')))
    const [tool] = webSearchPlugin().createTools?.(hostWithEdge(edgeFetch)) ?? []

    await expect(tool!.execute({ query: 'react news' })).rejects.toThrow('Search failed (500)')
  })

  it('throws WebSearchSchemaError carrying a capture report on a schema mismatch', async () => {
    // 2xx body that does not match SearchResponse (results must be an array).
    const edgeFetch = vi.fn(() =>
      Promise.resolve(edgeResponse(true, 200, { query: 'react news', results: 'nope' }))
    )
    const [tool] = webSearchPlugin().createTools?.(hostWithEdge(edgeFetch)) ?? []

    const error = await tool!.execute({ query: 'react news' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(WebSearchSchemaError)
    expect((error as WebSearchSchemaError).report).toMatchObject({
      pluginId: WEB_SEARCH_PLUGIN_ID,
      kind: 'schema_error',
      level: 'error',
      message: 'Search response did not match schema'
    })
    // Telemetry carries only validation issue paths/codes, never the payload.
    expect((error as WebSearchSchemaError).report.contexts?.search?.issues).toBeDefined()
  })

  it('manifest id matches the plugin id and exposes a web-search descriptor', () => {
    expect(webSearchPluginManifest.id).toBe(WEB_SEARCH_PLUGIN_ID)
    expect(webSearchPlugin().id).toBe(WEB_SEARCH_PLUGIN_ID)
    expect(webSearchPluginManifest.toolDescriptors?.map((d) => d.id)).toEqual([
      WEB_SEARCH_PLUGIN_ID
    ])
  })

  it('ships its activity summarizer on the tool descriptor (host renders, plugin owns presentation)', () => {
    const descriptor = webSearchPluginManifest.toolDescriptors?.[0]
    expect(descriptor?.summarizeActivity).toBe(summarizeWebSearchActivity)
  })

  describe('summarizeWebSearchActivity', () => {
    it('titles the view, reports the count and query, and renders each result', async () => {
      const view = await summarizeWebSearchActivity({
        query: 'react news',
        results: [
          { title: 'React 19', url: 'https://react.dev/19', snippet: 'What is new' },
          { title: 'Release notes', url: 'https://react.dev/notes', snippet: 'Changelog' }
        ]
      })
      expect(view.title).toBe('Web search')
      expect(view.status).toBeUndefined()
      expect(view.sections).toEqual([
        { kind: 'text', label: 'Results', value: '2' },
        { kind: 'text', label: 'Query', value: 'react news' },
        { kind: 'text', label: '1. React 19', value: 'https://react.dev/19\nWhat is new' },
        { kind: 'text', label: '2. Release notes', value: 'https://react.dev/notes\nChangelog' }
      ])
    })

    it('bounds a long snippet so it cannot flood the panel', async () => {
      const view = await summarizeWebSearchActivity({
        query: 'q',
        results: [{ title: 't', url: 'https://e.test', snippet: 'x'.repeat(500) }]
      })
      const result = view.sections.find((s) => s.kind === 'text' && s.label === '1. t')
      const value = result && result.kind === 'text' ? result.value : ''
      expect(value.startsWith('https://e.test\n')).toBe(true)
      expect(value.endsWith('…')).toBe(true)
      // url + newline + 300 snippet chars + ellipsis.
      expect(value.length).toBe('https://e.test\n'.length + 301)
    })

    it('caps the number of rendered results with an overflow note', async () => {
      const results = Array.from({ length: 11 }, (_, i) => ({
        title: `t${i}`,
        url: `https://e.test/${i}`,
        snippet: `s${i}`
      }))
      const view = await summarizeWebSearchActivity({ query: 'q', results })
      // 8 results rendered + Results + Query + the overflow note.
      expect(view.sections.filter((s) => /^\d+\. /.test(s.label)).length).toBe(8)
      expect(view.sections).toContainEqual({
        kind: 'text',
        label: '',
        value: '… (3 more results)'
      })
    })

    it('reports zero results and omits the query section when absent', () => {
      const view = summarizeWebSearchActivity({ results: [] })
      expect(view).toEqual({
        title: 'Web search',
        sections: [{ kind: 'text', label: 'Results', value: '0' }]
      })
    })

    it('tolerates malformed output without throwing', () => {
      expect(summarizeWebSearchActivity(undefined)).toEqual({
        title: 'Web search',
        sections: [{ kind: 'text', label: 'Results', value: '0' }]
      })
      expect(summarizeWebSearchActivity({ results: 'nope', query: 5 })).toEqual({
        title: 'Web search',
        sections: [{ kind: 'text', label: 'Results', value: '0' }]
      })
    })

    it('renders a result with missing fields without throwing', async () => {
      const view = await summarizeWebSearchActivity({ query: 'q', results: [{}] })
      expect(view.sections).toContainEqual({ kind: 'text', label: '1. (untitled)', value: '' })
    })
  })

  it('ships enabled by default via the manifest', () => {
    expect(webSearchPluginManifest.defaultEnabled).toBe(true)
  })

  it('satisfies the PluginModule contract for dynamic discovery', () => {
    expect(isPluginModule(webSearchModule)).toBe(true)
    expect(webSearchModule.manifest.id).toBe(WEB_SEARCH_PLUGIN_ID)
    expect(webSearchModule.createPlugin().id).toBe(WEB_SEARCH_PLUGIN_ID)
  })
})
