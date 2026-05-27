import { describe, expect, it, vi } from 'vitest'
import {
  createContentRuntime,
  type NodeRendererPlugin,
  type RuntimeFailureReason
} from '../src/runtime.js'

describe('createContentRuntime', () => {
  it('dispatches the highest-priority matching plugin for a node type', () => {
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

  it('invokes wrap once per render', () => {
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

    const plugin: NodeRendererPlugin<'codeBlock', string> = {
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
    }

    runtime.register(plugin)

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
})
