/**
 * The sidebar Office (issue #472) — what it drives, and what it falls back to.
 *
 * The stage itself is mocked: its bridge, bootstrap and agent-number lifecycle
 * are covered against the real thing in `@tinytinkerer/pixel-agents`' own
 * suite. What can only be checked here is that this surface drives the
 * ASSISTANT session — one store, the one #479 exported — and never reaches for
 * a chat store of its own the way the live labs legitimately do.
 */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PixelAgentsStageProps } from '@tinytinkerer/pixel-agents'

const session = vi.hoisted(() => ({
  conversations: [
    {
      id: 'conv-a',
      title: 'Hosting questions',
      isRunning: false,
      events: [] as unknown[],
      eventsLoaded: true
    },
    {
      id: 'conv-b',
      title: 'Plugin tools',
      isRunning: true,
      events: [] as unknown[],
      eventsLoaded: true
    }
  ],
  activeConversationId: 'conv-a',
  isAuthenticated: false,
  selectConversation: vi.fn(() => Promise.resolve()),
  startNewConversation: vi.fn(() => Promise.resolve()),
  deleteConversation: vi.fn(() => Promise.resolve()),
  resetActiveConversation: vi.fn(() => Promise.resolve()),
  signIn: vi.fn()
}))

const capability = vi.hoisted(() => ({ usePixelAgentsCapability: vi.fn(() => true) }))
const stageProps = vi.hoisted(() => ({ last: null as PixelAgentsStageProps | null }))

vi.mock('../session', () => ({ useDocsAssistantSession: () => session }))

vi.mock('@tinytinkerer/pixel-agents', () => ({
  PixelAgentsStage: (props: PixelAgentsStageProps) => {
    stageProps.last = props
    return <div data-testid="pixel-agents-stage" />
  },
  conversationActivityStatus: () => 'idle' as const
}))

vi.mock('../../pixel-agents/capability', () => ({
  usePixelAgentsCapability: capability.usePixelAgentsCapability
}))

vi.mock('../../pixel-agents/upstream-url', () => ({
  useResolveUpstreamUrl: () => (path: string) => `https://example.test/upstream/${path}`
}))

import { DOCS_ASSISTANT_OFFICE_WORKSPACE_DATABASE } from '../assistant-constants'
import { DocsAssistantOffice } from '../assistant-office'

afterEach(() => {
  vi.clearAllMocks()
  capability.usePixelAgentsCapability.mockReturnValue(true)
  stageProps.last = null
})

describe('DocsAssistantOffice', () => {
  it('projects the assistant session onto the office, with no chat panel of its own', () => {
    render(<DocsAssistantOffice />)

    expect(screen.getByTestId('pixel-agents-stage')).toBeInTheDocument()
    expect(stageProps.last?.conversations).toEqual([
      {
        id: 'conv-a',
        title: 'Hosting questions',
        isRunning: false,
        events: [],
        eventsLoaded: true
      },
      { id: 'conv-b', title: 'Plugin tools', isRunning: true, events: [], eventsLoaded: true }
    ])
    expect(stageProps.last?.activeConversationId).toBe('conv-a')
    // The chat is #480's widget, elsewhere on the page — an `assistant` here
    // would dock a second one inside the sidebar.
    expect(stageProps.last?.assistant).toBeUndefined()
  })

  it('asks for compact chrome and its own workspace, not the labs’ or the product’s', () => {
    render(<DocsAssistantOffice />)

    expect(stageProps.last?.chrome).toBe('compact')
    expect(stageProps.last?.workspaceDatabaseName).toBe(DOCS_ASSISTANT_OFFICE_WORKSPACE_DATABASE)
    expect(DOCS_ASSISTANT_OFFICE_WORKSPACE_DATABASE).not.toBe('tinytinkerer-docs-lab-pixel-agents')
    // Docusaurus serves the prepared bundle at `${baseUrl}upstream/**`; the
    // stage's own relative default would resolve against whatever nested
    // documentation route the reader happens to be on.
    expect(stageProps.last?.resolveUpstreamUrl?.('index.html')).toBe(
      'https://example.test/upstream/index.html'
    )
  })

  it('routes office-driven actions into the assistant session', () => {
    render(<DocsAssistantOffice />)

    stageProps.last?.actions.selectConversation('conv-b')
    stageProps.last?.actions.startNewConversation()
    stageProps.last?.actions.deleteConversation('conv-b')

    expect(session.selectConversation).toHaveBeenCalledWith('conv-b')
    expect(session.startNewConversation).toHaveBeenCalledTimes(1)
    expect(session.deleteConversation).toHaveBeenCalledWith('conv-b')
  })

  it('keeps a keyboard-operable conversation list beside the office', async () => {
    // The office is a canvas: a character click is not reachable without a
    // pointer, and since the product's own switcher was removed this list is
    // the only other way to manage an assistant conversation.
    render(<DocsAssistantOffice />)

    await userEvent.click(screen.getByText('Conversations (2)'))
    // Anchored at the title, which is where the row's accessible name starts
    // and where the delete button's ("Delete conversation …") does not.
    await userEvent.click(screen.getByRole('button', { name: /^Hosting questions/ }))

    expect(session.selectConversation).toHaveBeenCalledWith('conv-a')
    // Named apart from the live labs' "New conversation": a lab page carries
    // both, over two different sessions.
    expect(screen.getByRole('button', { name: 'New assistant conversation' })).toBeInTheDocument()
  })

  it('falls back to the list alone when the office cannot run', () => {
    capability.usePixelAgentsCapability.mockReturnValue(false)

    render(<DocsAssistantOffice />)

    expect(screen.queryByTestId('pixel-agents-stage')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Assistant conversations' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New assistant conversation' })).toBeInTheDocument()
  })

  it('routes to the fallback when the frame reports a bootstrap failure', () => {
    render(<DocsAssistantOffice />)

    act(() => stageProps.last?.onBootstrapError?.('Pixel Agents could not start. 500'))

    expect(capability.usePixelAgentsCapability).toHaveBeenLastCalledWith(true)
  })
})
