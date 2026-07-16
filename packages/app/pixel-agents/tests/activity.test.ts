import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { messagesForChatEvent, pixelToolName } from '../src/activity'

const event = (
  value: Partial<ChatEvent> & Pick<ChatEvent, 'id' | 'type' | 'payload'>
): ChatEvent => ({ timestamp: '2026-07-13T00:00:00.000Z', ...value })

describe('Pixel Agents activity projection', () => {
  it('maps steps and tool calls to stable Pixel Agents activity ids, stamped with the given agent id', () => {
    expect(
      messagesForChatEvent(
        event({
          id: 'step-start',
          type: 'agent.step.started',
          payload: { stepId: 's1', kind: 'think', title: 'Considering options' }
        }),
        7
      )
    ).toEqual([
      {
        type: 'agentToolStart',
        id: 7,
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
        }),
        7
      )
    ).toEqual([
      {
        type: 'agentToolStart',
        id: 7,
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

  it('maps run lifecycle events to a status pair, stamped with the given agent id', () => {
    expect(
      messagesForChatEvent(
        event({ id: 'start', type: 'agent.run.started', payload: { agentType: 'react' } }),
        3
      )
    ).toEqual([
      { type: 'agentToolsClear', id: 3 },
      { type: 'agentStatus', id: 3, status: 'active' }
    ])
    expect(
      messagesForChatEvent(
        event({ id: 'end', type: 'agent.run.completed', payload: { steps: 3 } }),
        3
      )
    ).toEqual([
      { type: 'agentToolsClear', id: 3 },
      { type: 'agentStatus', id: 3, status: 'waiting', awaitingInput: false }
    ])
  })

  it('stamps distinct agent ids for distinct conversations from the same event shape', () => {
    const base = event({
      id: 'tool-start',
      type: 'agent.tool.started',
      payload: { stepId: 's1', toolId: 'canvas.search', input: {} }
    })
    expect(messagesForChatEvent(base, 1)[0]).toMatchObject({ id: 1 })
    expect(messagesForChatEvent(base, 2)[0]).toMatchObject({ id: 2 })
  })

  it('ignores event types with no Pixel Agents projection', () => {
    expect(
      messagesForChatEvent(event({ id: 'msg', type: 'user.message', payload: { text: 'hi' } }), 1)
    ).toEqual([])
  })
})
