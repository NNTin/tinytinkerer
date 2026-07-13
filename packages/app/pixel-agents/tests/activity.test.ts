import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { messagesForChatEvent, pixelToolName } from '../src/activity'

const event = (
  value: Partial<ChatEvent> & Pick<ChatEvent, 'id' | 'type' | 'payload'>
): ChatEvent => ({ timestamp: '2026-07-13T00:00:00.000Z', ...value })

describe('Pixel Agents activity projection', () => {
  it('maps steps and tool calls to stable Pixel Agents activity ids', () => {
    expect(
      messagesForChatEvent(
        event({
          id: 'step-start',
          type: 'agent.step.started',
          payload: { stepId: 's1', kind: 'think', title: 'Considering options' }
        })
      )
    ).toEqual([
      {
        type: 'agentToolStart',
        id: 1,
        toolId: 'step:s1',
        status: 'Considering options',
        toolName: 'Read'
      }
    ])

    expect(
      messagesForChatEvent(
        event({
          id: 'tool-start',
          type: 'agent.tool.started',
          payload: { stepId: 's1', toolId: 'canvas.search', input: {} }
        })
      )
    ).toEqual([
      {
        type: 'agentToolStart',
        id: 1,
        toolId: 's1:canvas.search',
        status: 'canvas search',
        toolName: 'Read'
      }
    ])
  })

  it('classifies reading, shell, and writing tools', () => {
    expect(pixelToolName('canvas.thumbnail')).toBe('Read')
    expect(pixelToolName('terminal.exec')).toBe('Bash')
    expect(pixelToolName('mermaid.apply')).toBe('Write')
  })

  it('maps run lifecycle events to a status pair', () => {
    expect(
      messagesForChatEvent(
        event({ id: 'start', type: 'agent.run.started', payload: { agentType: 'react' } })
      )
    ).toEqual([
      { type: 'agentToolsClear', id: 1 },
      { type: 'agentStatus', id: 1, status: 'active' }
    ])
    expect(
      messagesForChatEvent(event({ id: 'end', type: 'agent.run.completed', payload: { steps: 3 } }))
    ).toEqual([
      { type: 'agentToolsClear', id: 1 },
      { type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: false }
    ])
  })

  it('ignores event types with no Pixel Agents projection', () => {
    expect(
      messagesForChatEvent(event({ id: 'msg', type: 'user.message', payload: { text: 'hi' } }))
    ).toEqual([])
  })
})
