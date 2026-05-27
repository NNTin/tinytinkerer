import { describe, expect, it, vi } from 'vitest'
import {
  createContentRuntime,
  type NodeRendererPlugin,
  type RuntimeFailureReason
} from '../src/index.js'

describe('createContentRuntime', () => {
  it('dispatches registered plugins per node type', () => {
    const runtime = createContentRuntime<string>({
      fallback: (failure) => `fallback:${failure.reason}:${failure.node.type}`
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

  it('resolves the highest-priority matching plugin for a node type', () => {
    const runtime = createContentRuntime<string>({
      fallback: () => 'fallback'
    })

    runtime.register({
      id: 'generic-code',
      nodeType: 'codeBlock',
      render: (node) => `generic:${node.code}`
    })
    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      priority: 10,
      matches: (node) => node.language === 'mermaid',
      render: (node) => `mermaid:${node.code}`
    })

    expect(
      runtime.renderNode({ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' })
    ).toBe('mermaid:graph TD\nA-->B')
    expect(
      runtime.renderNode({ type: 'codeBlock', code: 'const answer = 42', language: 'ts' })
    ).toBe('generic:const answer = 42')
  })

  it('falls back with noMatch when candidates exist but none match', () => {
    const fallback = vi.fn((failure: { reason: RuntimeFailureReason }) => failure.reason)
    const runtime = createContentRuntime<string>({ fallback })

    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      matches: (node) => node.language === 'mermaid',
      render: (node) => node.code
    })

    expect(runtime.renderNode({ type: 'codeBlock', code: '<html />', language: 'html' })).toBe(
      'noMatch'
    )
    expect(fallback).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'noMatch',
        node: { type: 'codeBlock', code: '<html />', language: 'html' }
      })
    )
  })

  it('falls back with policyBlocked when matching plugins are disallowed by execution policy', () => {
    const fallback = vi.fn((failure: { reason: RuntimeFailureReason }) => failure.reason)
    const runtime = createContentRuntime<string>({
      fallback,
      executionPolicy: {
        allowDom: false
      }
    })

    runtime.register({
      id: 'wireframe-code',
      nodeType: 'codeBlock',
      matches: (node) => node.language === 'wireframe',
      requirements: { clientOnly: true, needsDom: true },
      render: (node) => node.code
    })

    expect(runtime.renderNode({ type: 'codeBlock', code: '<html />', language: 'wireframe' })).toBe(
      'policyBlocked'
    )
    expect(fallback).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'policyBlocked',
        plugin: expect.objectContaining({ id: 'wireframe-code' })
      })
    )
  })

  it('uses the plugin fallback when render throws', () => {
    const runtime = createContentRuntime<string>({
      fallback: (failure) => `host:${failure.reason}`
    })

    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      matches: (node) => node.language === 'mermaid',
      render: () => {
        throw new Error('boom')
      },
      fallback: (node, failure) => `${failure.reason}:${node.language}:${node.code}`
    })

    const result = runtime.renderNode({
      type: 'codeBlock',
      code: 'graph TD\nA-->B',
      language: 'mermaid'
    })
    expect(result).toBe('renderFailed:mermaid:graph TD\nA-->B')
  })

  it('falls through to the host fallback when the plugin fallback also throws', () => {
    const runtime = createContentRuntime<string>({
      fallback: (failure) => `host:${failure.reason}`
    })

    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      matches: (node) => node.language === 'mermaid',
      render: () => {
        throw new Error('boom')
      },
      fallback: () => {
        throw new Error('worse')
      }
    })

    expect(
      runtime.renderNode({ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' })
    ).toBe('host:renderFailed')
  })

  it('invokes wrap once per render and exposes a fallback factory', () => {
    const wrap = vi.fn((result: string) => `<${result}>`)
    const runtime = createContentRuntime<string>({
      fallback: (failure) => `host:${failure.reason}`,
      wrap
    })

    runtime.register({
      id: 'code-block',
      nodeType: 'codeBlock',
      render: (node) => node.code
    })

    expect(runtime.renderNode({ type: 'codeBlock', code: 'x' })).toBe('<x>')
    expect(wrap).toHaveBeenCalledTimes(1)
  })

  it('calls plugin.load at most once across concurrent prepareNode calls', async () => {
    const load = vi.fn(() => Promise.resolve())
    const runtime = createContentRuntime<string>({
      fallback: () => 'fallback'
    })

    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      matches: (node) => node.language === 'mermaid',
      requirements: { lazy: true },
      load,
      render: (node) => node.code
    })

    await Promise.all([
      runtime.prepareNode({ type: 'codeBlock', code: 'a', language: 'mermaid' }),
      runtime.prepareNode({ type: 'codeBlock', code: 'b', language: 'mermaid' }),
      runtime.prepareNode({ type: 'codeBlock', code: 'c', language: 'mermaid' })
    ])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries plugin.load after a failure', async () => {
    let attempts = 0
    const runtime = createContentRuntime<string>({
      fallback: (failure) => `fallback:${failure.reason}`
    })

    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      matches: (node) => node.language === 'mermaid',
      requirements: { lazy: true },
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
      runtime.prepareNode({ type: 'codeBlock', code: 'graph', language: 'mermaid' })
    ).rejects.toThrow('first attempt')
    expect(
      runtime.renderNode({ type: 'codeBlock', code: 'graph', language: 'mermaid' })
    ).toBe('fallback:loadFailed')
    await expect(
      runtime.prepareNode({ type: 'codeBlock', code: 'graph', language: 'mermaid' })
    ).resolves.toBeUndefined()
    expect(attempts).toBe(2)
  })

  it('prepares nested nodes across a document', async () => {
    const load = vi.fn(() => Promise.resolve())
    const runtime = createContentRuntime<string>({
      fallback: () => 'fallback'
    })

    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      matches: (node) => node.language === 'mermaid',
      requirements: { lazy: true },
      load,
      render: (node) => node.code
    })

    await runtime.prepareDocument({
      nodes: [
        {
          type: 'blockquote',
          children: [
            {
              type: 'list',
              ordered: false,
              children: [
                {
                  type: 'listItem',
                  children: [{ type: 'codeBlock', code: 'graph TD', language: 'mermaid' }]
                }
              ]
            }
          ]
        }
      ]
    })

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('exposes ordered plugins and resolution results', () => {
    const runtime = createContentRuntime<string>({ fallback: () => '' })

    runtime.register({
      id: 'generic-code',
      nodeType: 'codeBlock',
      render: (node) => node.code
    })
    runtime.register({
      id: 'mermaid-code',
      nodeType: 'codeBlock',
      priority: 20,
      matches: (node) => node.language === 'mermaid',
      render: (node) => node.code
    })

    expect(runtime.getPlugins('codeBlock').map((plugin) => plugin.id)).toEqual([
      'mermaid-code',
      'generic-code'
    ])

    expect(
      runtime.resolve({ type: 'codeBlock', code: 'graph TD\nA-->B', language: 'mermaid' })
    ).toEqual({
      ok: true,
      plugin: expect.objectContaining({ id: 'mermaid-code' }),
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: 'mermaid-code' }),
        expect.objectContaining({ id: 'generic-code' })
      ])
    })
  })
})
