import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import {
  activeCooldown,
  buildConversationHistory,
  buildCurrentTimeline,
  buildTurns,
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

  it('normalizes unsupported models', () => {
    expect(normalizeSelectedModel('openai/gpt-4o')).toBe('openai/gpt-4.1-mini')
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

  it('drops expired cooldowns', () => {
    expect(activeCooldown(new Date(Date.now() - 1_000).toISOString())).toBeUndefined()
  })
})
