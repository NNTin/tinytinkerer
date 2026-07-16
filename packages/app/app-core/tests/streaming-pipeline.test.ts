import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ContentDocument } from '@tinytinkerer/contracts'
import {
  appendLiveChatEvent,
  buildTurns,
  executeChatPrompt,
  reconcileTurns,
  turnsEquivalent,
  type ChatRuntimeContext,
  type ChatRuntimeFactory,
  type ConversationRepository,
  type PreferencesStore
} from '../src/index.js'

const event = <T extends ChatEvent['type']>(
  type: T,
  payload: Extract<ChatEvent, { type: T }>['payload']
): Extract<ChatEvent, { type: T }> =>
  ({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    payload
  }) as Extract<ChatEvent, { type: T }>

const doc = (source: string): ContentDocument => ({
  nodes:
    source.trim().length > 0
      ? [{ type: 'paragraph', id: 'paragraph-0', children: [{ type: 'text', value: source }] }]
      : []
})

describe('appendLiveChatEvent — bounded live snapshot retention (issue #339)', () => {
  it('collapses consecutive assistant.chunk events into the latest one', () => {
    let events: ChatEvent[] = [event('user.message', { text: 'hi' })]
    events = appendLiveChatEvent(
      events,
      event('assistant.chunk', { source: 'a', content: doc('a') })
    )
    events = appendLiveChatEvent(
      events,
      event('assistant.chunk', { source: 'ab', content: doc('ab') })
    )
    events = appendLiveChatEvent(
      events,
      event('assistant.chunk', { source: 'abc', content: doc('abc') })
    )

    const chunks = events.filter((e) => e.type === 'assistant.chunk')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type === 'assistant.chunk' && chunks[0].payload.source).toBe('abc')
    // The user message is untouched and stays first.
    expect(events[0]?.type).toBe('user.message')
  })

  it('collapses consecutive reasoning.chunk events likewise', () => {
    let events: ChatEvent[] = []
    events = appendLiveChatEvent(events, event('reasoning.chunk', { source: '', text: 'th' }))
    events = appendLiveChatEvent(events, event('reasoning.chunk', { source: '', text: 'thinking' }))
    const chunks = events.filter((e) => e.type === 'reasoning.chunk')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type === 'reasoning.chunk' && chunks[0].payload.text).toBe('thinking')
  })

  it('drops the live assistant.chunk once assistant.done supersedes it', () => {
    let events: ChatEvent[] = [event('user.message', { text: 'hi' })]
    events = appendLiveChatEvent(
      events,
      event('assistant.chunk', { source: 'abc', content: doc('abc') })
    )
    events = appendLiveChatEvent(
      events,
      event('assistant.done', { source: 'abc', content: doc('abc') })
    )
    expect(events.some((e) => e.type === 'assistant.chunk')).toBe(false)
    expect(events.filter((e) => e.type === 'assistant.done')).toHaveLength(1)
  })

  it('drops the live reasoning.chunk once reasoning.done supersedes it', () => {
    let events: ChatEvent[] = []
    events = appendLiveChatEvent(events, event('reasoning.chunk', { source: '', text: 'thinking' }))
    events = appendLiveChatEvent(events, event('reasoning.done', { source: '', text: 'thinking' }))
    expect(events.some((e) => e.type === 'reasoning.chunk')).toBe(false)
    expect(events.filter((e) => e.type === 'reasoning.done')).toHaveLength(1)
  })

  it('keeps a whole streamed turn bounded to O(1) live snapshots', () => {
    let events: ChatEvent[] = [event('user.message', { text: 'hi' })]
    // 200 assistant deltas interleaved with a few reasoning deltas.
    for (let i = 0; i < 200; i += 1) {
      if (i % 50 === 0) {
        events = appendLiveChatEvent(
          events,
          event('reasoning.chunk', { source: '', text: `r${i}` })
        )
      }
      events = appendLiveChatEvent(
        events,
        event('assistant.chunk', { source: `s${i}`, content: doc(`s${i}`) })
      )
    }
    events = appendLiveChatEvent(
      events,
      event('assistant.done', { source: 's199', content: doc('s199') })
    )
    // After the run settles: zero live chunks retained of EITHER type,
    // regardless of how many deltas streamed or how they interleaved.
    expect(events.some((e) => e.type === 'assistant.chunk')).toBe(false)
    expect(events.some((e) => e.type === 'reasoning.chunk')).toBe(false)
  })

  it('does not perturb non-collapsible events or their order', () => {
    const a = event('agent.step.started', { stepId: 's1', kind: 'synthesize', title: 'Composing' })
    const b = event('agent.usage', { promptTokens: 10 })
    let events: ChatEvent[] = []
    events = appendLiveChatEvent(events, a)
    events = appendLiveChatEvent(events, b)
    expect(events).toEqual([a, b])
  })
})

describe('reconcileTurns / turnsEquivalent — settled turn identity (issue #340)', () => {
  const settled = [
    event('user.message', { text: 'first' }),
    event('assistant.done', { source: 'answer one', content: doc('answer one') })
  ]

  it('reuses the previous object for a settled turn while a later turn streams', () => {
    const before = buildTurns([
      ...settled,
      event('user.message', { text: 'second' }),
      event('assistant.chunk', { source: 'par', content: doc('par') })
    ])
    const after = buildTurns([
      ...settled,
      event('user.message', { text: 'second' }),
      event('assistant.chunk', { source: 'partial', content: doc('partial') })
    ])

    const reconciled = reconcileTurns(before, after)
    // Settled first turn: same object as before (skips re-render).
    expect(reconciled[0]).toBe(before[0])
    // Streaming turn changed, so it is the freshly built object.
    expect(reconciled[1]).toBe(after[1])
    expect(reconciled[1]).not.toBe(before[1])
  })

  it('turnsEquivalent is true for an unchanged settled turn and false when content changes', () => {
    const a = buildTurns(settled)[0]
    const b = buildTurns(settled)[0]
    expect(a && b && turnsEquivalent(a, b)).toBe(true)

    const changed = buildTurns([
      event('user.message', { text: 'first' }),
      event('assistant.done', { source: 'answer TWO', content: doc('answer TWO') })
    ])[0]
    expect(a && changed && turnsEquivalent(a, changed)).toBe(false)
  })

  it('detects an activity change even when the answer text is unchanged', () => {
    const base = [
      event('user.message', { text: 'q' }),
      event('agent.step.started', { stepId: 's1', kind: 'think', title: 'Thinking' }),
      event('assistant.chunk', { source: 'ans', content: doc('ans') })
    ]
    const a = buildTurns(base)[0]
    const b = buildTurns([
      ...base,
      event('agent.tool.started', { stepId: 's1', toolId: 't', input: {} })
    ])[0]
    expect(a && b && turnsEquivalent(a, b)).toBe(false)
  })
})

const runtimeFactoryYielding = (events: ChatEvent[]): ChatRuntimeFactory => ({
  create: () => ({
    // eslint-disable-next-line @typescript-eslint/require-await
    run: async function* () {
      for (const e of events) {
        yield e
      }
    }
  })
})

describe('executeChatPrompt — aborted run stops appending/persisting (issue #332)', () => {
  it('surfaces and persists nothing when the signal is already aborted', async () => {
    const onEvent = vi.fn()
    const appendEvent = vi.fn(() => Promise.resolve())
    const conversations = { appendEvent } as unknown as ConversationRepository
    const preferences = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve())
    } as unknown as PreferencesStore

    const controller = new AbortController()
    controller.abort()

    await executeChatPrompt({
      conversationId: 'c1',
      existingEvents: [],
      prompt: 'hi',
      runtimeFactory: runtimeFactoryYielding([
        event('assistant.done', { source: 'late', content: doc('late') })
      ]),
      conversations,
      preferences,
      signal: controller.signal,
      onEvent,
      onRateLimitState: vi.fn()
    })

    expect(onEvent).not.toHaveBeenCalled()
    expect(appendEvent).not.toHaveBeenCalled()
  })
})

describe('executeChatPrompt / runPrompt — conversation-scoped runtime context (issue #430)', () => {
  it("passes the conversation id into the factory's create(context) so host capabilities (human prompts, inspector capture) can be attributed to it", async () => {
    const contexts: (ChatRuntimeContext | undefined)[] = []
    const runtimeFactory: ChatRuntimeFactory = {
      create: (context) => {
        contexts.push(context)
        return {
          run: async function* () {}
        }
      }
    }
    const conversations = {
      appendEvent: vi.fn(() => Promise.resolve())
    } as unknown as ConversationRepository
    const preferences = {
      get: vi.fn(() => Promise.resolve(undefined)),
      set: vi.fn(() => Promise.resolve())
    } as unknown as PreferencesStore

    await executeChatPrompt({
      conversationId: 'conv-42',
      existingEvents: [],
      prompt: 'hi',
      runtimeFactory,
      conversations,
      preferences,
      onEvent: vi.fn(),
      onRateLimitState: vi.fn()
    })

    expect(contexts).toEqual([{ conversationId: 'conv-42' }])
  })
})
