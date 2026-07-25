import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  conversationOrder: ['conv-a'] as string[],
  conversations: {
    'conv-a': {
      id: 'conv-a',
      title: 'First conversation',
      events: [] as unknown[],
      isRunning: false,
      eventsLoaded: true
    }
  },
  conversationId: 'conv-a',
  selectConversation: vi.fn(),
  startNewConversation: vi.fn(),
  deleteConversation: vi.fn()
}))

const capability = vi.hoisted(() => ({ usePixelAgentsCapability: vi.fn(() => true) }))

vi.mock('@tinytinkerer/app-browser', () => ({
  useChatStore: (selector: (state: typeof store) => unknown) => selector(store)
}))

vi.mock('@tinytinkerer/pixel-agents', () => ({
  PixelAgentsStage: (props: { assistant: React.ReactNode }) => (
    <div data-testid="pixel-agents-stage">{props.assistant}</div>
  ),
  conversationActivityStatus: () => 'awaiting-input' as const
}))

vi.mock('../../pixel-agents/capability', () => ({
  usePixelAgentsCapability: capability.usePixelAgentsCapability
}))

vi.mock('../../pixel-agents/upstream-url', () => ({
  useResolveUpstreamUrl: () => (path: string) => `https://example.test/upstream/${path}`
}))

vi.mock('../ExecutionTracePanel', () => ({
  ExecutionTracePanel: () => <div data-testid="execution-trace-panel" />
}))

import { ExecutionTraceLabContent } from '../ExecutionTraceLabContent'

describe('ExecutionTraceLabContent', () => {
  afterEach(() => {
    vi.clearAllMocks()
    store.conversationOrder = ['conv-a']
    store.conversationId = 'conv-a'
    capability.usePixelAgentsCapability.mockReturnValue(true)
  })

  it('always renders the textual conversation switcher alongside the graphical office', () => {
    render(<ExecutionTraceLabContent />)
    expect(screen.getByText('First conversation')).toBeInTheDocument()
    expect(screen.getByTestId('pixel-agents-stage')).toBeInTheDocument()
    expect(screen.getByTestId('execution-trace-panel')).toBeInTheDocument()
  })

  it('falls back to a text-only surface (no PixelAgentsStage) when capability says no', () => {
    capability.usePixelAgentsCapability.mockReturnValue(false)
    render(<ExecutionTraceLabContent />)
    expect(screen.getByText('First conversation')).toBeInTheDocument()
    expect(screen.queryByTestId('pixel-agents-stage')).not.toBeInTheDocument()
    // The trace panel still renders on its own in fallback mode.
    expect(screen.getByTestId('execution-trace-panel')).toBeInTheDocument()
  })

  it('creates, selects, and deletes conversations through the isolated docs chat store', async () => {
    const user = userEvent.setup()
    render(<ExecutionTraceLabContent />)

    await user.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(store.startNewConversation).toHaveBeenCalledTimes(1)

    const deleteButton = screen.getByRole('button', {
      name: 'Delete conversation "First conversation"'
    })
    await user.click(deleteButton)
    await user.click(
      screen.getByRole('button', {
        name: 'Confirm deleting conversation "First conversation"'
      })
    )
    expect(store.deleteConversation).toHaveBeenCalledWith('conv-a')
  })
})
