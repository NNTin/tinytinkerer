import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Tool } from '@tinytinkerer/app-core'
import type { AppAssistantPolicy, AppToolResultRecord } from '../src/app-assistant-policy.js'
import { createRuntime } from '../src/runtime/create-runtime.js'

// The generic half of issue #478: an app can contribute system instructions at
// the three reasoning boundaries and rewrite its own answers, and an app that
// contributes nothing is completely unaffected. What the documentation
// assistant contributes is tested in apps/docs.

const sse = (...events: Record<string, unknown>[]): string =>
  `${events.map((event) => `data: ${JSON.stringify(event)}`).join('\n\n')}\n\ndata: [DONE]\n\n`

const prose = (text: string): string => sse({ choices: [{ delta: { content: text } }] })

const call = (name: string): string =>
  sse({
    choices: [
      { delta: { tool_calls: [{ index: 0, id: 'c1', function: { name, arguments: '{}' } }] } }
    ]
  })

const appTool = (id: string, output: unknown = 'ok'): Tool<unknown, unknown> => ({
  id,
  description: `${id} tool`,
  schema: z.object({}).passthrough(),
  execute: () => Promise.resolve(output)
})

type Harness = {
  systemPrompts: () => string[]
  run: (prompt?: string) => Promise<string>
}

const harness = (options: {
  responses: string[]
  policy?: AppAssistantPolicy
  tools?: Tool<unknown, unknown>[]
  disabled?: string[]
}): Harness => {
  const requests: string[] = []
  const queue = [...options.responses]
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    // createEdgeFetch always serializes the body before calling fetch, so a
    // non-string here would be a contract change rather than something to
    // stringify defensively.
    requests.push(typeof init?.body === 'string' ? init.body : '')
    const next = queue.shift()
    if (next === undefined) throw new Error(`unmocked model call to ${url}`)
    return Promise.resolve(new Response(next, { status: 200 }))
  })

  const runtime = createRuntime({
    baseUrl: '',
    getToken: () => 'token',
    getModel: () => 'openai/gpt-4.1-mini',
    agentType: 'react',
    appToolGroup: {
      id: 'demo',
      label: 'Demo',
      tools: options.tools ?? [appTool('alpha'), appTool('beta')]
    },
    ...(options.disabled ? { appToolDisablement: { demo: options.disabled } } : {}),
    ...(options.policy ? { appAssistantPolicy: options.policy } : {})
  })

  return {
    systemPrompts: () =>
      requests.map((body) => {
        const messages = (JSON.parse(body) as { messages: { role: string; content: string }[] })
          .messages
        return messages.find((message) => message.role === 'system')?.content ?? ''
      }),
    run: async (prompt = 'hello') => {
      let source = ''
      for await (const event of runtime.run(prompt)) {
        if (event.type === 'assistant.done') {
          source = (event.payload as { source: string }).source
        }
      }
      return source
    }
  }
}

describe('an app assistant policy', () => {
  it('appends its instructions to each boundary the run reaches', async () => {
    const instructions = vi.fn(({ boundary }: { boundary: string }) => `POLICY(${boundary})`)
    const test = harness({
      responses: [prose('no tool needed'), prose('the answer')],
      policy: { instructions }
    })

    await test.run()

    const [decision, synthesis] = test.systemPrompts()
    expect(decision).toContain('You are a ReAct agent')
    expect(decision).toContain('POLICY(decision)')
    expect(synthesis).toContain('You are tinytinkerer')
    expect(synthesis).toContain('POLICY(synthesis)')
  })

  it('binds its instructions to the app tools that actually registered', async () => {
    const instructions = vi.fn(() => 'POLICY')
    const test = harness({
      responses: [prose('no'), prose('answer')],
      policy: { instructions },
      disabled: ['beta']
    })

    await test.run()

    expect(instructions).toHaveBeenCalledWith(expect.objectContaining({ toolIds: ['alpha'] }))
  })

  it('sends unchanged prompts for an app that contributes no policy', async () => {
    const withPolicy = harness({
      responses: [prose('no'), prose('answer')],
      policy: { instructions: () => undefined }
    })
    await withPolicy.run()

    const without = harness({ responses: [prose('no'), prose('answer')] })
    await without.run()

    // An `instructions` hook that declines is byte-identical to no hook at all,
    // which is what keeps every other shell's prompts untouched.
    expect(withPolicy.systemPrompts()).toEqual(without.systemPrompts())
    expect(without.systemPrompts()[0]).toContain('You are a ReAct agent')
  })

  it('finalizes the answer from successful results only, without their inputs', async () => {
    const seen: AppToolResultRecord[][] = []
    const test = harness({
      responses: [call('alpha'), call('boom'), prose('done'), prose('composed')],
      tools: [
        appTool('alpha', { page: 1 }),
        {
          id: 'boom',
          description: 'always fails',
          schema: z.object({}).passthrough(),
          execute: () => Promise.reject(new Error('nope'))
        }
      ],
      policy: {
        finalizeAnswer: ({ source, results }) => {
          seen.push([...results])
          return `${source} [cited]`
        }
      }
    })

    expect(await test.run()).toBe('composed [cited]')
    // The failed call is absent; the surviving record carries no `input`, and it
    // carries the provenance the HOST stamped at registration rather than
    // anything the tool declared about itself.
    expect(seen).toEqual([
      [{ toolId: 'alpha', output: { page: 1 }, source: { kind: 'app', groupId: 'demo' } }]
    ])
  })

  it('stamps provenance the tool itself cannot forge', async () => {
    const seen: AppToolResultRecord[][] = []
    const test = harness({
      responses: [call('alpha'), prose('done'), prose('answer')],
      tools: [
        {
          ...appTool('alpha'),
          // A contributor claiming to be somebody else's app group.
          source: { kind: 'app', groupId: 'documentation' }
        }
      ],
      policy: {
        finalizeAnswer: ({ source, results }) => {
          seen.push([...results])
          return source
        }
      }
    })

    await test.run()

    expect(seen[0]?.[0]?.source).toEqual({ kind: 'app', groupId: 'demo' })
  })

  it('runs the finalizer once, after the answer is complete', async () => {
    const finalizeAnswer = vi.fn(({ source }: { source: string }) => `${source}!`)
    const test = harness({
      responses: [
        prose('no'),
        sse(
          { choices: [{ delta: { content: 'one ' } }] },
          { choices: [{ delta: { content: 'two' } }] }
        )
      ],
      policy: { finalizeAnswer }
    })

    expect(await test.run()).toBe('one two!')
    expect(finalizeAnswer).toHaveBeenCalledTimes(1)
  })
})
