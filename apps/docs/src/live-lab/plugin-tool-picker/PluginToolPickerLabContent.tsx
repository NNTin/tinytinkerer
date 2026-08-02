// Only ever reached once a <LiveLab> boundary has mounted client-side AND its
// <LiveSessionGate> has decided the docs session is ready/running (see
// PluginToolPickerLab.tsx's lazy import) — so importing the product runtime and
// its stylesheets here, at module scope, never affects a page that doesn't
// render a <PluginToolPickerLab>, and never runs during static rendering.
import { useCallback, useMemo, useState } from 'react'
import { ChatApp, useBrowserApp, useChatStore, useToolTree } from '@tinytinkerer/app-browser'
import {
  conversationActivityStatus,
  PixelAgentsStage,
  type PixelAgentsConversation
} from '@tinytinkerer/pixel-agents'
import '@tinytinkerer/app-shell/styles.css'
import '@tinytinkerer/pixel-agents/styles.css'
import {
  DOCS_PIXEL_AGENTS_DOCK_LAYOUT_STORAGE_KEY,
  DOCS_PIXEL_AGENTS_WORKSPACE_DATABASE
} from '../pixel-agents/constants'
import { usePixelAgentsCapability } from '../pixel-agents/capability'
import {
  ConversationSwitcher,
  type ConversationSwitcherItem
} from '../pixel-agents/ConversationSwitcher'
import { useResolveUpstreamUrl } from '../pixel-agents/upstream-url'
import { DOCS_PLUGIN_TOOL_PICKER_CHAT_STORAGE_KEY } from './constants'
import { PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID } from './demo-tools'
import { PluginToolPickerLabChatLoading } from './loading-screen'

type CompareLabels = { beforeId: string; afterId: string }

const DEFAULT_COMPARE_PROMPT = 'Roll a die, then explain what "activation" means for a plugin.'

// issue #453: this lab's tool-tree state is the REAL production picker
// (useToolTree/ToolTreeSlot from app-browser, unmodified) driving the REAL
// per-run runtime — see live-lab/client-runtime.tsx's `appToolGroup`. There is
// no simulated selection anywhere in this component: a toggle here is the same
// `setAppToolSelection` chokepoint the shipped tool picker uses, so the next
// `sendPrompt` genuinely receives exactly what the picker shows.
export const PluginToolPickerLabContent = (): React.JSX.Element => {
  const resolveUpstreamUrl = useResolveUpstreamUrl()
  const [pixelAgentsFailed, setPixelAgentsFailed] = useState(false)
  const canRunPixelAgents = usePixelAgentsCapability(pixelAgentsFailed)
  const browserApp = useBrowserApp()

  // No `fallbackSummarizer` argument: the lab's own `BrowserApp` carries one
  // (createDocsBrowserApp attaches it to any app with a tool group), so this
  // reads exactly what the shipped picker in the composer below reads.
  const { summarizer, input, toolIdsByPlugin } = useToolTree()
  const view = useMemo(() => (summarizer ? summarizer(input) : null), [summarizer, input])
  const demoGroupView = view?.plugins.find(
    (plugin) => plugin.id === PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID
  )
  const demoToolIds = toolIdsByPlugin[PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID] ?? []

  const conversationOrder = useChatStore((state) => state.conversationOrder)
  const conversationsById = useChatStore((state) => state.conversations)
  const activeConversationId = useChatStore((state) => state.conversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const startNewConversation = useChatStore((state) => state.startNewConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)

  const conversations = useMemo<PixelAgentsConversation[]>(
    () =>
      conversationOrder.flatMap((conversationId) => {
        const slice = conversationsById[conversationId]
        return slice
          ? [
              {
                id: slice.id,
                title: slice.title,
                events: slice.events,
                isRunning: slice.isRunning,
                eventsLoaded: slice.eventsLoaded
              }
            ]
          : []
      }),
    [conversationOrder, conversationsById]
  )

  const [compareLabels, setCompareLabels] = useState<CompareLabels | null>(null)
  const [comparePrompt, setComparePrompt] = useState(DEFAULT_COMPARE_PROMPT)
  const [confirmingCompare, setConfirmingCompare] = useState(false)
  const [compareRunning, setCompareRunning] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  const switcherItems = useMemo<ConversationSwitcherItem[]>(
    () =>
      conversations.map((conversation) => {
        let title = conversation.title
        if (compareLabels?.beforeId === conversation.id) {
          title = 'Before: all demo tools enabled'
        } else if (compareLabels?.afterId === conversation.id) {
          title = 'After: your current selection'
        }
        return { id: conversation.id, title, status: conversationActivityStatus(conversation) }
      }),
    [conversations, compareLabels]
  )

  const actions = useMemo(
    () => ({ selectConversation, startNewConversation, deleteConversation }),
    [selectConversation, startNewConversation, deleteConversation]
  )

  const handleBootstrapError = useCallback((message: string | null) => {
    setPixelAgentsFailed(message !== null)
  }, [])

  // Runs `comparePrompt` twice against two FRESH conversations — once with every
  // demo tool enabled ("before"), once with the visitor's current tool-picker
  // selection ("after") — then restores the current selection so the compare
  // step never leaves the picker in a different state than the visitor left it
  // in. Reads/writes the settings and chat stores directly (not through the
  // render-time selector hooks above) because each step must see the OTHER
  // step's just-written state, not a value captured before this handler started.
  const runCompare = useCallback(async () => {
    setConfirmingCompare(false)
    setCompareRunning(true)
    setCompareError(null)
    const chatStore = browserApp.stores.chat
    const settingsStore = browserApp.stores.settings
    const prompt = comparePrompt.trim()
    if (!prompt) {
      setCompareRunning(false)
      return
    }
    const restoreDisabled =
      settingsStore.getState().appToolDisablement[PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID] ?? []
    try {
      await settingsStore
        .getState()
        .setAppToolSelection({ id: PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID, toolIds: demoToolIds }, [])
      await chatStore.getState().startNewConversation()
      const beforeId = chatStore.getState().conversationId
      if (!beforeId) throw new Error('Could not start the "before" conversation.')
      await chatStore.getState().sendPrompt(prompt, beforeId)

      await settingsStore
        .getState()
        .setAppToolSelection(
          { id: PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID, toolIds: demoToolIds },
          restoreDisabled
        )
      await chatStore.getState().startNewConversation()
      const afterId = chatStore.getState().conversationId
      if (!afterId) throw new Error('Could not start the "after" conversation.')
      await chatStore.getState().sendPrompt(prompt, afterId)

      setCompareLabels({ beforeId, afterId })
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : 'The comparison run failed.')
      // Best-effort: never leave the picker on the "before" (all-enabled)
      // baseline if something failed mid-flow.
      await settingsStore
        .getState()
        .setAppToolSelection(
          { id: PLUGIN_TOOL_PICKER_APP_TOOL_GROUP_ID, toolIds: demoToolIds },
          restoreDisabled
        )
    } finally {
      setCompareRunning(false)
    }
  }, [browserApp, comparePrompt, demoToolIds])

  const assistant = (
    <ChatApp
      mode="sidebar"
      morphable={false}
      fill
      storageKey={DOCS_PLUGIN_TOOL_PICKER_CHAT_STORAGE_KEY}
      LoadingComponent={PluginToolPickerLabChatLoading}
      inspectorPanelSupported
    />
  )

  return (
    <div className="plugin-tool-picker-lab">
      {/* A read-out of the production picker's state, NOT a second picker
          (issue #480 re-review, finding 6). The lab used to render its own
          `ToolTreeSlot` beside the one the embedded ChatApp now renders, which
          put two controls over one selection store; the shipped control is the
          one to teach, so this annotates it instead of competing with it. */}
      <div className="plugin-tool-picker-lab__picker" role="group" aria-label="Enabled demo tools">
        <div className="plugin-tool-picker-lab__picker-summary">
          <p>
            <strong>
              {demoGroupView
                ? `${demoGroupView.enabledCount} of ${demoGroupView.toolCount}`
                : '0 of 0'}
            </strong>{' '}
            demo tools enabled. Change the selection with the tool picker in the assistant&apos;s
            composer below — this panel is a live read of that same selection, and changes apply
            from your next message.
          </p>
          {/* Always-visible textual list (issue #453 acceptance: full functionality
              without relying on the Pixel Agents visualization) — the exact tool
              ids/descriptions/enabled state, independent of the modal below. */}
          <ul className="plugin-tool-picker-lab__tool-list">
            {(demoGroupView?.tools ?? []).map((tool) => (
              <li key={tool.id}>
                <code>{tool.id}</code> — {tool.description}{' '}
                <strong>{tool.checked ? '(enabled)' : '(disabled)'}</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ConversationSwitcher
        conversations={switcherItems}
        activeConversationId={activeConversationId}
        onSelect={(conversationId) => void selectConversation(conversationId)}
        onCreate={() => void startNewConversation()}
        onDelete={(conversationId) => void deleteConversation(conversationId)}
      />
      {canRunPixelAgents ? (
        // See PixelAgentsLabContent.tsx's identical wrapper for why this explicit
        // height is required: @tinytinkerer/pixel-agents's root is `height: 100%`
        // all the way down, which collapses to zero without a definite-height
        // ancestor (a Docusaurus MDX article provides none on its own).
        <div className="plugin-tool-picker-lab__stage">
          <PixelAgentsStage
            conversations={conversations}
            activeConversationId={activeConversationId}
            actions={actions}
            assistant={assistant}
            resolveUpstreamUrl={resolveUpstreamUrl}
            workspaceDatabaseName={DOCS_PIXEL_AGENTS_WORKSPACE_DATABASE}
            dockLayoutStorageKey={DOCS_PIXEL_AGENTS_DOCK_LAYOUT_STORAGE_KEY}
            onBootstrapError={handleBootstrapError}
          />
        </div>
      ) : (
        <div className="plugin-tool-picker-lab__fallback">{assistant}</div>
      )}

      <div
        className="plugin-tool-picker-lab__compare"
        role="group"
        aria-label="Before/after comparison"
      >
        <h3>Compare before vs. after</h3>
        <label htmlFor="plugin-tool-picker-compare-prompt">Prompt to send both times</label>
        <textarea
          id="plugin-tool-picker-compare-prompt"
          value={comparePrompt}
          onChange={(event) => setComparePrompt(event.target.value)}
          rows={2}
        />
        {!confirmingCompare ? (
          <button
            type="button"
            onClick={() => setConfirmingCompare(true)}
            disabled={compareRunning || comparePrompt.trim().length === 0}
          >
            Compare (2 model calls)
          </button>
        ) : (
          <div
            className="plugin-tool-picker-lab__compare-confirm"
            role="alertdialog"
            aria-label="Confirm comparison"
          >
            <p>
              This sends the prompt above TWICE — once with every demo tool enabled, once with your
              current selection — performing <strong>two model calls</strong> and may consume
              additional quota. Continue?
            </p>
            <button type="button" onClick={() => void runCompare()}>
              Yes, compare
            </button>
            <button type="button" onClick={() => setConfirmingCompare(false)}>
              Cancel
            </button>
          </div>
        )}
        {compareRunning ? <p role="status">Running the before/after comparison…</p> : null}
        {compareError ? <p role="alert">{compareError}</p> : null}
        {compareLabels ? (
          <p role="status">
            Comparison ready — use the conversation list above to switch between{' '}
            <strong>Before: all demo tools enabled</strong> and{' '}
            <strong>After: your current selection</strong>. Each keeps its own independent events.
          </p>
        ) : null}
      </div>
    </div>
  )
}
