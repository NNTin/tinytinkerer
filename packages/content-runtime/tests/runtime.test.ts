import { describe, expect, it, vi } from 'vitest'
import type { ContentNode } from '@tinytinkerer/content-core'
import {
  createContentRuntime,
  type NodeRendererPlugin
} from '../src/index.js'

describe('createContentRuntime', () => {
  it('dispatches registered plugins per node type', () => {
    const runtime = createContentRuntime<string>({
      fallback: (node) => `fallback:${node.type}`
    })

    const codePlugin: NodeRendererPlugin<'codeBlock', string> = {
      id: 'core:codeBlock',
      nodeType: 'codeBlock',
      render: (node) => `code(${node.code})`
    }
    const paragraphPlugin: NodeRendererPlugin<'paragraph', string> = {
      id: 'core:paragraph',
      nodeType: 'paragraph',
      render: (node) =>
        `p(${node.children.map((child) => (child.type === 'text' ? child.value : '?')).join('')})`
    }

    runtime.register(codePlugin)
    runtime.register(paragraphPlugin)

    const results = runtime.renderDocument({
      nodes: [
        { type: 'paragraph', children: [{ type: 'text', value: 'hi' }] },
        { type: 'codeBlock', code: 'x' }
      ]
    })
    expect(results).toEqual(['p(hi)', 'code(x)'])
  })

  it('falls back to the host fallback when no plugin is registered', () => {
    const runtime = createContentRuntime<string>({
      fallback: (node) => `fallback:${node.type}`
    })

    const result = runtime.renderNode({ type: 'mermaid', code: 'graph TD\nA-->B' })
    expect(result).toBe('fallback:mermaid')
  })

  it('uses the plugin fallback when render throws', () => {
    const runtime = createContentRuntime<string>({
      fallback: (node) => `host:${node.type}`
    })

    runtime.register({
      id: 'mermaid',
      nodeType: 'mermaid',
      render: () => {
        throw new Error('boom')
      },
      fallback: (node) => `plugin:${node.code}`
    })

    const result = runtime.renderNode({ type: 'mermaid', code: 'graph' })
    expect(result).toBe('plugin:graph')
  })

  it('falls through to the host fallback when the plugin fallback also throws', () => {
    const runtime = createContentRuntime<string>({
      fallback: (node) => `host:${node.type}`
    })

    runtime.register({
      id: 'mermaid',
      nodeType: 'mermaid',
      render: () => {
        throw new Error('boom')
      },
      fallback: () => {
        throw new Error('worse')
      }
    })

    expect(runtime.renderNode({ type: 'mermaid', code: 'graph' })).toBe('host:mermaid')
  })

  it('invokes wrap once per render and exposes a fallback factory', () => {
    const wrap = vi.fn((result: string) => `<${result}>`)
    const runtime = createContentRuntime<string>({
      fallback: (node) => `host:${node.type}`,
      wrap
    })

    runtime.register({
      id: 'codeBlock',
      nodeType: 'codeBlock',
      render: (node) => node.code
    })

    expect(runtime.renderNode({ type: 'codeBlock', code: 'x' })).toBe('<x>')
    expect(wrap).toHaveBeenCalledTimes(1)
  })

  it('calls plugin.load at most once across concurrent ensureLoaded calls', async () => {
    const load = vi.fn(() => Promise.resolve())
    const runtime = createContentRuntime<string>({
      fallback: () => 'fallback'
    })

    runtime.register({
      id: 'mermaid',
      nodeType: 'mermaid',
      load,
      render: (node) => node.code
    })

    await Promise.all([
      runtime.ensureLoaded({ type: 'mermaid', code: 'a' }),
      runtime.ensureLoaded({ type: 'mermaid', code: 'b' }),
      runtime.ensureLoaded({ type: 'mermaid', code: 'c' })
    ])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries plugin.load after a failure', async () => {
    let attempts = 0
    const runtime = createContentRuntime<string>({
      fallback: () => 'fallback'
    })

    runtime.register({
      id: 'mermaid',
      nodeType: 'mermaid',
      load: () => {
        attempts += 1
        if (attempts === 1) {
          return Promise.reject(new Error('first attempt'))
        }
        return Promise.resolve()
      },
      render: (node) => node.code
    })

    await expect(
      runtime.ensureLoaded({ type: 'mermaid', code: 'a' })
    ).rejects.toThrow('first attempt')
    await expect(
      runtime.ensureLoaded({ type: 'mermaid', code: 'a' })
    ).resolves.toBeUndefined()
    expect(attempts).toBe(2)
  })

  it('exposes registered plugins via has/getPlugin', () => {
    const runtime = createContentRuntime<string>({ fallback: () => '' })
    const plugin: NodeRendererPlugin<'codeBlock', string> = {
      id: 'core:codeBlock',
      nodeType: 'codeBlock',
      render: (node) => node.code
    }
    runtime.register(plugin)
    expect(runtime.has('codeBlock')).toBe(true)
    expect(runtime.has('mermaid' satisfies ContentNode['type'])).toBe(false)
    expect(runtime.getPlugin('codeBlock')).toBe(plugin)
  })
})
