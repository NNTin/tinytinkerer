import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import {
  activeCooldown,
  buildConversationHistory,
  buildCurrentTimeline,
  buildTurns,
  canSendPrompt,
  defaultChatState,
  inferPlan,
  normalizeSelectedModel
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

describe('app-core helpers', () => {
  it('infers search plans', () => {
    expect(inferPlan('latest ai news').steps.some((step) => step.id === 'search')).toBe(true)
  })

  it('falls back to the default model for null/empty values', () => {
    expect(normalizeSelectedModel(null)).toBe('openai/gpt-4.1-mini')
    expect(normalizeSelectedModel(undefined)).toBe('openai/gpt-4.1-mini')
    expect(normalizeSelectedModel('')).toBe('openai/gpt-4.1-mini')
    expect(normalizeSelectedModel('   ')).toBe('openai/gpt-4.1-mini')
  })

  it('preserves any non-empty model id including dynamic models', () => {
    expect(normalizeSelectedModel('openai/gpt-4o')).toBe('openai/gpt-4o')
    expect(normalizeSelectedModel('meta/llama-4-scout-17b-16e-instruct')).toBe('meta/llama-4-scout-17b-16e-instruct')
  })

  it('builds conversation history from completed turns only', () => {
    expect(
      buildConversationHistory([
        event('user.message', { text: 'hello' }),
        event('assistant.done', { text: 'hi' }),
        event('user.message', { text: 'broken' }),
        event('error', { message: 'oops' })
      ])
    ).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ])
  })

  it('projects turns and timeline entries', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hello' }),
      event('planning.started', { summary: 'Understanding request' }),
      event('execution.step.started', {
        step: { id: 'search', summary: 'Search web', toolCall: { toolId: 'web-search', input: { query: 'hello' } } },
        index: 0
      }),
      event('assistant.done', { text: 'hi' })
    ]

    expect(buildTurns(events, '')).toHaveLength(1)
    expect(buildCurrentTimeline(events)).toHaveLength(2)
  })

  it('keeps one turn when rate-limit waiting later completes', () => {
    const turns = buildTurns(
      [
        event('user.message', { text: 'latest news' }),
        event('rate.limit.waiting', {
          retryAfterMs: 1_000,
          retryAt: new Date(Date.now() + 1_000).toISOString(),
          message: 'Rate limited for a moment.',
          autoRetry: true
        }),
        event('assistant.done', { text: 'Here is the latest update.' })
      ],
      ''
    )

    expect(turns).toHaveLength(1)
    expect(turns[0]?.id).toEqual(expect.any(String))
    expect(turns[0]).toMatchObject({
      userText: 'latest news',
      assistantText: 'Here is the latest update.',
      notice: {
        kind: 'rate-limit',
        message: 'Rate limited for a moment.',
        level: 'warning'
      }
    })
  })

  it('keeps one turn when a system notice later completes', () => {
    const turns = buildTurns(
      [
        event('user.message', { text: 'hello' }),
        event('system', { message: 'Using cached context.', level: 'info' }),
        event('assistant.done', { text: 'Hi there.' })
      ],
      ''
    )

    expect(turns).toHaveLength(1)
    expect(turns[0]?.id).toEqual(expect.any(String))
    expect(turns[0]).toMatchObject({
      userText: 'hello',
      assistantText: 'Hi there.',
      notice: {
        kind: 'system',
        message: 'Using cached context.',
        level: 'info'
      }
    })
  })

  it('drops expired cooldowns', () => {
    expect(activeCooldown(new Date(Date.now() - 1_000).toISOString())).toBeUndefined()
  })

  it('buildCurrentTimeline returns empty array when no user.message is present', () => {
    expect(buildCurrentTimeline([])).toEqual([])
    expect(
      buildCurrentTimeline([
        event('planning.started', { summary: 'Understanding request' }),
        event('assistant.done', { text: 'hi' })
      ])
    ).toEqual([])
  })

  it('execution.step.completed with empty note does not appear in timeline', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hello' }),
      event('execution.step.completed', { stepId: 'step-1', note: '' }),
      event('assistant.done', { text: 'hi' })
    ]
    const timeline = buildCurrentTimeline(events)
    expect(timeline.every((entry) => entry.label !== '')).toBe(true)
    expect(timeline).toHaveLength(0)
  })

  describe('canSendPrompt', () => {
    it('returns false when conversationId is absent', () => {
      expect(canSendPrompt({ ...defaultChatState(), conversationId: undefined })).toBe(false)
    })

    it('returns false when isRunning is true', () => {
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id', isRunning: true })).toBe(false)
    })

    it('returns false when cooldown is active', () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id', cooldownUntil: future })).toBe(false)
    })

    it('returns true when cooldown has expired', () => {
      const past = new Date(Date.now() - 1_000).toISOString()
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id', cooldownUntil: past })).toBe(true)
    })

    it('returns true when all conditions are clear', () => {
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id' })).toBe(true)
    })
  })
})
