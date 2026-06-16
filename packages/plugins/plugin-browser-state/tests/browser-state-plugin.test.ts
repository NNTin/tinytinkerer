import {
  isPluginModule,
  PluginCaptureError,
  type DomReadResult,
  type PluginHost
} from '@tinytinkerer/contracts'
import { describe, expect, it, vi } from 'vitest'
import * as browserStateModule from '../src/index'
import {
  BROWSER_STATE_PLUGIN_ID,
  BrowserStateHostError,
  browserStatePlugin,
  browserStatePluginManifest,
  readDomInputSchema,
  summarizeReadDomActivity
} from '../src/index'

const okResult: DomReadResult = {
  url: 'https://example.test/#/',
  title: 'Example',
  viewport: { width: 1024, height: 768 },
  matchedCount: 2,
  nodes: [{ tag: 'div' }, { tag: 'section' }],
  truncated: false
}

const hostWithDom = (readDom: NonNullable<PluginHost['readDom']>): PluginHost => ({
  capture: vi.fn(),
  readDom
})

describe('browserStatePlugin', () => {
  it('is a valid, discoverable plugin module that is off by default', () => {
    expect(isPluginModule(browserStateModule)).toBe(true)
    expect(browserStatePluginManifest.id).toBe(BROWSER_STATE_PLUGIN_ID)
    expect(browserStatePlugin().id).toBe(browserStatePluginManifest.id)
    // No defaultEnabled → the host treats it as off until the user opts in.
    expect(browserStatePluginManifest.defaultEnabled).toBeFalsy()
  })

  it('exposes a read_dom tool when the host can read the page', () => {
    const tools = browserStatePlugin().createTools?.(hostWithDom(vi.fn())) ?? []
    expect(tools.map((t) => t.id)).toEqual(['read_dom'])
  })

  it('contributes no tool when the host cannot read the page', () => {
    const host: PluginHost = { capture: vi.fn() }
    const tools = browserStatePlugin().createTools?.(host) ?? []
    expect(tools).toEqual([])
  })

  it('forwards the query to the host reader and returns its result verbatim', async () => {
    const readDom = vi.fn(() => Promise.resolve(okResult))
    const [tool] = browserStatePlugin().createTools?.(hostWithDom(readDom)) ?? []

    const result = await tool!.execute({
      selector: '.mermaid',
      include: ['html'],
      maxNodes: 5,
      maxChars: 1_000
    })

    expect(readDom).toHaveBeenCalledWith({
      selector: '.mermaid',
      include: ['html'],
      maxNodes: 5,
      maxChars: 1_000
    })
    expect(result).toEqual(okResult)
  })

  it('builds a clean query without undefined fields when none are supplied', async () => {
    const readDom = vi.fn(() => Promise.resolve(okResult))
    const [tool] = browserStatePlugin().createTools?.(hostWithDom(readDom)) ?? []

    await tool!.execute({})

    expect(readDom).toHaveBeenCalledWith({})
  })

  it('throws a capturable BrowserStateHostError when the reader itself fails', async () => {
    const readDom = vi.fn(() => Promise.reject(new Error('boom')))
    const [tool] = browserStatePlugin().createTools?.(hostWithDom(readDom)) ?? []

    const error = await tool!.execute({ selector: 'div' }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BrowserStateHostError)
    expect(error).toBeInstanceOf(PluginCaptureError)
    // The report never carries any page content.
    expect((error as BrowserStateHostError).report).toMatchObject({
      pluginId: BROWSER_STATE_PLUGIN_ID,
      kind: 'host_error',
      level: 'error',
      message: 'DOM reader failed'
    })
  })
})

describe('summarizeReadDomActivity', () => {
  it('is wired onto the read_dom tool descriptor', () => {
    const descriptor = browserStatePluginManifest.toolDescriptors?.find((d) => d.id === 'read_dom')
    expect(descriptor?.summarizeActivity).toBe(summarizeReadDomActivity)
  })

  it('summarizes a matched read as ok with Matched/Returned/URL sections', () => {
    const view = summarizeReadDomActivity(okResult)
    expect(view.title).toBe('Read page DOM')
    expect(view.status).toBe('ok')
    expect(view.sections).toContainEqual({ label: 'Matched', value: '2' })
    expect(view.sections).toContainEqual({ label: 'Returned', value: '2' })
    expect(view.sections).toContainEqual({ label: 'URL', value: 'https://example.test/#/' })
  })

  it('marks a read that matched nothing as warn', () => {
    const view = summarizeReadDomActivity({ ...okResult, matchedCount: 0, nodes: [] })
    expect(view.status).toBe('warn')
  })

  it('adds a Truncated section when the host omitted matches or content', () => {
    const view = summarizeReadDomActivity({ ...okResult, truncated: true })
    expect(view.sections).toContainEqual({
      label: 'Truncated',
      value: 'Some matches or content were omitted'
    })
  })

  it('tolerates malformed output without throwing', () => {
    const view = summarizeReadDomActivity(undefined)
    expect(view.title).toBe('Read page DOM')
    expect(view.status).toBe('warn')
    expect(view.sections).toEqual([
      { label: 'Matched', value: '0' },
      { label: 'Returned', value: '0' }
    ])
  })
})

describe('readDomInputSchema', () => {
  it('accepts an empty query (no selector)', () => {
    expect(readDomInputSchema.safeParse({}).success).toBe(true)
  })

  it('rejects an empty selector string', () => {
    expect(readDomInputSchema.safeParse({ selector: '' }).success).toBe(false)
  })

  it('rejects an unknown include field', () => {
    expect(readDomInputSchema.safeParse({ include: ['styles'] }).success).toBe(false)
  })

  it('rejects maxNodes above the cap', () => {
    expect(readDomInputSchema.safeParse({ maxNodes: 101 }).success).toBe(false)
  })

  it('accepts a valid selector query', () => {
    const parsed = readDomInputSchema.safeParse({
      selector: '[aria-label="Mermaid diagram"]',
      include: ['html', 'rect'],
      maxNodes: 10
    })
    expect(parsed.success).toBe(true)
  })
})
