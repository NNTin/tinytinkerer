import type { ChatEvent } from '@tinytinkerer/app-browser'
import { describe, expect, it } from 'vitest'
import { buildConversationHistory } from './chat-history'

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

describe('buildConversationHistory', () => {
  it('keeps only completed user and assistant turns', () => {
    const history = buildConversationHistory([
      event('user.message', { text: 'hello, my name is Tin' }),
      event('planning.started', { summary: 'Understanding request' }),
      event('assistant.done', { text: 'Hello Tin!' }),
      event('user.message', { text: 'This request fails' }),
      event('error', { message: 'failed' }),
      event('user.message', { text: 'Do you know my name?' }),
      event('assistant.done', { text: 'Yes, your name is Tin.' })
    ])

    expect(history).toEqual([
      { role: 'user', content: 'hello, my name is Tin' },
      { role: 'assistant', content: 'Hello Tin!' },
      { role: 'user', content: 'Do you know my name?' },
      { role: 'assistant', content: 'Yes, your name is Tin.' }
    ])
  })

  it('drops incomplete turns with empty assistant output', () => {
    const history = buildConversationHistory([
      event('user.message', { text: 'hello' }),
      event('assistant.done', { text: '' }),
      event('user.message', { text: 'try again' }),
      event('assistant.done', { text: 'working now' })
    ])

    expect(history).toEqual([
      { role: 'user', content: 'try again' },
      { role: 'assistant', content: 'working now' }
    ])
  })
})
