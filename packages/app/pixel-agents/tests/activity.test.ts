import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import { conversationActivityStatus, messagesForChatEvent, pixelToolName } from '../src/activity'
import type { PixelAgentsConversation } from '../src/stage-props'

const event = (
  value: Partial<ChatEvent> & Pick<ChatEvent, 'id' | 'type' | 'payload'>
): ChatEvent => ({ timestamp: '2026-07-13T00:00:00.000Z', ...value })

const conversation = (
  value: Partial<PixelAgentsConversation> & Pick<PixelAgentsConversation, 'id' | 'title'>
): PixelAgentsConversation => ({ events: [], isRunning: false, eventsLoaded: true, ...value })

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

describe('conversationActivityStatus', () => {
  it('is "idle" for an unhydrated background conversation', () => {
    expect(
      conversationActivityStatus(
        conversation({ id: 'c', title: 'C', events: [], eventsLoaded: false })
      )
    ).toBe('idle')
  })

  it('is "awaiting-input" for a hydrated conversation with no completed run yet', () => {
    expect(conversationActivityStatus(conversation({ id: 'c', title: 'C' }))).toBe('awaiting-input')
  })

  it('is "completed" once a run has completed cleanly', () => {
    const events = [
      event({ id: 'e1', type: 'agent.run.started', payload: { agentType: 'react' } }),
      event({ id: 'e2', type: 'agent.run.completed', payload: { steps: 1 } })
    ]
    expect(conversationActivityStatus(conversation({ id: 'c', title: 'C', events }))).toBe(
      'completed'
    )
  })

  it('is "failed" when the most recent run ended with an unresolved tool/step failure', () => {
    const events = [
      event({ id: 'e1', type: 'agent.run.started', payload: { agentType: 'react' } }),
      event({
        id: 'e2',
        type: 'agent.tool.failed',
        payload: { stepId: 's1', toolId: 'canvas.search', error: 'boom' }
      })
    ]
    expect(conversationActivityStatus(conversation({ id: 'c', title: 'C', events }))).toBe('failed')
  })

  it('does not carry a failure from an earlier, already-superseded run', () => {
    const events = [
      event({ id: 'e1', type: 'agent.run.started', payload: { agentType: 'react' } }),
      event({
        id: 'e2',
        type: 'agent.tool.failed',
        payload: { stepId: 's1', toolId: 'canvas.search', error: 'boom' }
      }),
      event({ id: 'e3', type: 'agent.run.completed', payload: { steps: 1 } }),
      event({ id: 'e4', type: 'agent.run.started', payload: { agentType: 'react' } }),
      event({ id: 'e5', type: 'agent.run.completed', payload: { steps: 1 } })
    ]
    expect(conversationActivityStatus(conversation({ id: 'c', title: 'C', events }))).toBe(
      'completed'
    )
  })

  it('is "running" while a run is in flight with no open tool', () => {
    expect(conversationActivityStatus(conversation({ id: 'c', title: 'C', isRunning: true }))).toBe(
      'running'
    )
  })

  it('is "running-tool" while a run is in flight with an open tool/step', () => {
    const events = [
      event({ id: 'e1', type: 'agent.run.started', payload: { agentType: 'react' } }),
      event({
        id: 'e2',
        type: 'agent.tool.started',
        payload: { stepId: 's1', toolId: 'canvas.search', input: {} }
      })
    ]
    expect(
      conversationActivityStatus(conversation({ id: 'c', title: 'C', isRunning: true, events }))
    ).toBe('running-tool')
  })

  it('is "running" once every open tool has closed, even while still running', () => {
    const events = [
      event({ id: 'e1', type: 'agent.run.started', payload: { agentType: 'react' } }),
      event({
        id: 'e2',
        type: 'agent.tool.started',
        payload: { stepId: 's1', toolId: 'canvas.search', input: {} }
      }),
      event({
        id: 'e3',
        type: 'agent.tool.completed',
        payload: { stepId: 's1', toolId: 'canvas.search', output: {} }
      })
    ]
    expect(
      conversationActivityStatus(conversation({ id: 'c', title: 'C', isRunning: true, events }))
    ).toBe('running')
  })
})
