// @vitest-environment jsdom
import '@testing-library/jest-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({
  stageProps: undefined as Record<string, unknown> | undefined,
  chatProps: undefined as Record<string, unknown> | undefined
}))

const storeState = vi.hoisted(() => ({
  conversationOrder: ['conversation-a', 'conversation-b'],
  conversations: {
    'conversation-a': {
      id: 'conversation-a',
      title: 'First conversation',
      events: [],
      isRunning: false,
      eventsLoaded: true
    },
    'conversation-b': {
      id: 'conversation-b',
      title: 'Second conversation',
      events: [{ id: 'e1' }],
      isRunning: true,
      eventsLoaded: false
    }
  },
  conversationId: 'conversation-a',
  selectConversation: vi.fn(),
  startNewConversation: vi.fn(),
  deleteConversation: vi.fn()
}))

vi.mock('@tinytinkerer/pixel-agents', () => ({
  PixelAgentsStage: (props: Record<string, unknown>) => {
    captured.stageProps = props
    return <div data-testid="pixel-agents-stage">{props.assistant as React.ReactNode}</div>
  }
}))

vi.mock('@tinytinkerer/app-browser', () => ({
  createAppLoadingScreens: () => ({
    BootScreen: () => null,
    RouteLoading: () => null,
    ChatLoading: () => null
  }),
  useChatStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  ChatApp: (props: Record<string, unknown>) => {
    captured.chatProps = props
    return <div data-testid="pixel-agents-chat" />
  }
}))

import PixelAgentsPage from './pixel-agents-page'

beforeEach(() => {
  captured.stageProps = undefined
  captured.chatProps = undefined
})

afterEach(cleanup)

describe('PixelAgentsPage', () => {
  it('composes the office stage with docked sidebar chat', () => {
    render(<PixelAgentsPage />)

    expect(captured.stageProps?.assistant).toBeDefined()
    expect(captured.chatProps).toMatchObject({
      mode: 'sidebar',
      morphable: false,
      fill: true,
      storageKey: 'tinytinkerer:pixel-agents-chat-layout:v1',
      inspectorPanelSupported: true
    })
  })

  it('derives the conversations array in display order from the store slices', () => {
    render(<PixelAgentsPage />)

    expect(captured.stageProps?.conversations).toEqual([
      {
        id: 'conversation-a',
        title: 'First conversation',
        events: [],
        isRunning: false,
        eventsLoaded: true
      },
      {
        id: 'conversation-b',
        title: 'Second conversation',
        events: [{ id: 'e1' }],
        isRunning: true,
        eventsLoaded: false
      }
    ])
    expect(captured.stageProps?.activeConversationId).toBe('conversation-a')
  })

  it('wires the three office-driven actions to the store', () => {
    render(<PixelAgentsPage />)

    const actions = captured.stageProps?.actions as {
      selectConversation: unknown
      startNewConversation: unknown
      deleteConversation: unknown
    }
    expect(actions.selectConversation).toBe(storeState.selectConversation)
    expect(actions.startNewConversation).toBe(storeState.startNewConversation)
    expect(actions.deleteConversation).toBe(storeState.deleteConversation)
  })
})
