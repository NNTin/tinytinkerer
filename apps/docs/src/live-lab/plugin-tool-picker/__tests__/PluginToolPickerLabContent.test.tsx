import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID } from '../demo-tools'

// The literal group id below mirrors demo-tools.ts's stable id — a literal, not
// the import above, because vi.mock factories are hoisted above every import in
// this file and may not reference an imported binding. The `expect` assertions
// further down still use the real imported constant, so a rename there would
// fail loudly.
const { DEMO_TOOL_IDS, fixedView } = vi.hoisted(() => {
  const ids = ['lab_always_fails', 'lab_explain_plugin_concept', 'lab_roll_dice']
  return {
    DEMO_TOOL_IDS: ids,
    fixedView: () => ({
      plugins: [
        {
          id: 'plugin-tool-picker-lab-demo-tools',
          label: 'Tool-picker lab demo tools',
          checked: 'all' as const,
          enabledCount: 3,
          toolCount: 3,
          tools: ids.map((id) => ({ id, description: `${id} description`, checked: true }))
        }
      ],
      enabledCount: 3,
      toolCount: 3
    })
  }
})

const chatState = vi.hoisted(() => ({
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
  startNewConversation: vi.fn(() => {
    chatState.conversationId = 'conv-new'
  }),
  deleteConversation: vi.fn(),
  sendPrompt: vi.fn(async () => {})
}))

const settingsState = vi.hoisted(() => ({
  appToolDisablement: {},
  setAppToolSelection: vi.fn(
    (group: { id: string; toolIds: string[] }, disabledToolIds: string[]) => {
      settingsState.appToolDisablement = {
        ...settingsState.appToolDisablement,
        [group.id]: disabledToolIds
      }
    }
  )
}))

const capability = vi.hoisted(() => ({ usePixelAgentsCapability: vi.fn(() => true) }))

vi.mock('@tinytinkerer/app-browser', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
  useBrowserApp: () => ({
    stores: {
      chat: { getState: () => chatState },
      settings: { getState: () => settingsState }
    }
  }),
  useToolTree: () => ({
    summarizer: fixedView,
    input: { plugins: [] },
    toolIdsByPlugin: { 'plugin-tool-picker-lab-demo-tools': DEMO_TOOL_IDS },
    appGroupIds: ['plugin-tool-picker-lab-demo-tools']
  }),
  genericToolTreeSummarizer: fixedView,
  ChatApp: () => <div data-testid="chat-app" />
}))

vi.mock('@tinytinkerer/pixel-agents', () => ({
  PixelAgentsStage: (props: { assistant: React.ReactNode }) => (
    <div data-testid="pixel-agents-stage">{props.assistant}</div>
  ),
  conversationActivityStatus: () => 'awaiting-input' as const
}))

vi.mock('../../../pixel-agents/capability', () => ({
  usePixelAgentsCapability: capability.usePixelAgentsCapability
}))

vi.mock('../../../pixel-agents/upstream-url', () => ({
  useResolveUpstreamUrl: () => (path: string) => `https://example.test/upstream/${path}`
}))

vi.mock('../loading-screen', () => ({ PluginToolPickerLabChatLoading: () => null }))

import { PluginToolPickerLabContent } from '../PluginToolPickerLabContent'

describe('PluginToolPickerLabContent', () => {
  afterEach(() => {
    vi.clearAllMocks()
    chatState.conversationOrder = ['conv-a']
    chatState.conversationId = 'conv-a'
    settingsState.appToolDisablement = {}
    capability.usePixelAgentsCapability.mockReturnValue(true)
  })

  it('shows the exact enabled demo tool ids and descriptions as text, independent of the picker modal', () => {
    render(<PluginToolPickerLabContent />)
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    for (const id of DEMO_TOOL_IDS) {
      expect(screen.getByText(id)).toBeInTheDocument()
    }
  })

  it('renders no picker of its own — it annotates the one in the composer', () => {
    // The lab used to mount a second `ToolTreeSlot` over the same selection
    // store as the embedded ChatApp's (issue #480 re-review, finding 6). Two
    // controls for one setting is not a teaching aid; the read-out below is.
    render(<PluginToolPickerLabContent />)
    expect(screen.queryByRole('button', { name: /tool picker|available tools/i })).toBeNull()
    expect(screen.getByRole('group', { name: 'Enabled demo tools' })).toBeInTheDocument()
  })

  it('renders the Pixel Agents stage and the accessible chat surface together', () => {
    render(<PluginToolPickerLabContent />)
    expect(screen.getByTestId('pixel-agents-stage')).toBeInTheDocument()
    expect(screen.getByTestId('chat-app')).toBeInTheDocument()
  })

  it('falls back to the accessible chat surface alone when Pixel Agents capability says no', () => {
    capability.usePixelAgentsCapability.mockReturnValue(false)
    render(<PluginToolPickerLabContent />)
    expect(screen.queryByTestId('pixel-agents-stage')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-app')).toBeInTheDocument()
  })

  it('requires explicit confirmation before running a before/after comparison', async () => {
    const user = userEvent.setup()
    render(<PluginToolPickerLabContent />)

    await user.click(screen.getByRole('button', { name: 'Compare (2 model calls)' }))
    expect(screen.getByText(/two model calls/i)).toBeInTheDocument()
    expect(chatState.sendPrompt).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Yes, compare' }))

    await waitFor(() => expect(chatState.sendPrompt).toHaveBeenCalledTimes(2))
    // First run: every demo tool enabled (denylist cleared).
    expect(settingsState.setAppToolSelection).toHaveBeenNthCalledWith(
      1,
      { id: PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID, toolIds: DEMO_TOOL_IDS },
      []
    )
    expect(screen.getByText(/Comparison ready/)).toBeInTheDocument()
  })

  it('cancelling the confirmation performs no model call', async () => {
    const user = userEvent.setup()
    render(<PluginToolPickerLabContent />)

    await user.click(screen.getByRole('button', { name: 'Compare (2 model calls)' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(chatState.sendPrompt).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Compare (2 model calls)' })).toBeInTheDocument()
  })
})
