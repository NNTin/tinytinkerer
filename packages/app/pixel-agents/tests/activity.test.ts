import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { messagesForChatEvent, messagesForUnseenChatEvents, pixelToolName } from '../src/activity'

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

  it('does not replay events that were already projected', () => {
    const completed = event({
      id: 'done',
      type: 'agent.tool.completed',
      payload: { stepId: 's1', toolId: 'canvas.search', output: {} }
    })
    const seen = new Set<string>(['done'])
    expect(messagesForUnseenChatEvents([completed], seen)).toEqual([])
  })
})
