import {
  isPluginModule,
  PluginRegistry,
  type PluginEdgeResponse,
  type PluginHost
} from '@tinytinkerer/agent-core'
import { EDGE_ROUTE_PATHS } from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as webSearchModule from '../src/index'
import {
  WEB_SEARCH_PLUGIN_ID,
  webSearchPlugin,
  webSearchPluginManifest
} from '../src/index'

// Minimal edge response stub mirroring the host PluginEdgeResponse surface.
const edgeResponse = (ok: boolean, status: number, body: unknown): PluginEdgeResponse => ({
  ok,
  status,
  json: () => Promise.resolve(body)
})

const hostWithEdge = (
  edgeFetch: NonNullable<PluginHost['edgeFetch']>
): PluginHost => ({ capture: vi.fn(), edgeFetch })

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

    expect(edgeFetch).toHaveBeenCalledWith(EDGE_ROUTE_PATHS.search, { query: 'react news' }, {
      area: 'search'
    })
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

  it('builds the tool through the registry against the host edge capability', () => {
    const registry = new PluginRegistry()
    registry.register(webSearchPlugin())
    const tools = registry.collectTools(new Set([WEB_SEARCH_PLUGIN_ID]), hostWithEdge(vi.fn()))
    expect(tools.map((t) => t.id)).toEqual([WEB_SEARCH_PLUGIN_ID])
  })

  it('manifest id matches the plugin id and exposes a web-search descriptor', () => {
    expect(webSearchPluginManifest.id).toBe(WEB_SEARCH_PLUGIN_ID)
    expect(webSearchPlugin().id).toBe(WEB_SEARCH_PLUGIN_ID)
    expect(webSearchPluginManifest.toolDescriptors?.map((d) => d.id)).toEqual([
      WEB_SEARCH_PLUGIN_ID
    ])
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
