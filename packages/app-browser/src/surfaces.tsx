import { buildCurrentTimeline, buildTurns, type TimelineEntry, type Turn } from '@tinytinkerer/app-core'
import {
  mcpDiscoveryResultSchema,
  type ChatEvent,
  type McpDiscoveryResult,
  type McpServerConfig,
  type SystemStatus
} from '@tinytinkerer/contracts'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { useAuthStore, useBrowserApp, useChatStore, useSettingsStore, useStatusStore } from './app'
import { formatCooldown, useChatCooldown, useGitHubOAuth } from './hooks'
import { useGitHubUser } from './github-user'
import { useGitHubModels, type ModelEntry } from './github-models'
import { startStatusPolling } from './status'
import { OFFLINE_SYSTEM_STATUS } from './stores/status-store'
import { createEdgeFetch } from './runtime/edge-fetch'

type ToolEvent = Extract<ChatEvent, { type: 'tool.call.completed' | 'tool.call.failed' }>

export type ChatSurfaceController = {
  events: ChatEvent[]
  token: string | null
  turns: Turn[]
  timeline: TimelineEntry[]
  toolEvents: ToolEvent[]
  isRunning: boolean
  isRetryPending: boolean
  showThinkingTimeline: boolean
  showToolActivity: boolean
  cooldownRemainingMs: number
  isCoolingDown: boolean
  submitLabel: string
  submitPrompt: (prompt: string) => Promise<boolean>
  resetConversation: () => Promise<void>
  cancelRetry: () => void
}

export const useChatSurfaceController = (): ChatSurfaceController => {
  const events = useChatStore((state) => state.events)
  const isRunning = useChatStore((state) => state.isRunning)
  const isRetryPending = useChatStore((state) => state.isRetryPending)
  const sendPrompt = useChatStore((state) => state.sendPrompt)
  const resetConversation = useChatStore((state) => state.resetConversation)
  const cancelRetry = useChatStore((state) => state.cancelRetry)
  const refreshStatus = useStatusStore((state) => state.refresh)
  const token = useAuthStore((state) => state.token)
  const showThinkingTimeline = useSettingsStore((state) => state.showThinkingTimeline)
  const showToolActivity = useSettingsStore((state) => state.showToolActivity)
  const { cooldownRemainingMs, isCoolingDown } = useChatCooldown()

  useEffect(() => startStatusPolling(refreshStatus), [refreshStatus])

  const turns = useMemo(() => buildTurns(events), [events])
  const timeline = useMemo(() => buildCurrentTimeline(events), [events])
  const toolEvents = useMemo(
    () =>
      events.filter(
        (event): event is ToolEvent =>
          event.type === 'tool.call.completed' || event.type === 'tool.call.failed'
      ),
    [events]
  )

  const submitLabel = isCoolingDown
    ? formatCooldown(cooldownRemainingMs)
    : isRunning
      ? 'Thinking…'
      : 'Send'

  const submitPrompt = async (prompt: string): Promise<boolean> => {
    const trimmed = prompt.trim()
    if (!trimmed || isCoolingDown || isRunning) {
      return false
    }

    await sendPrompt(trimmed)
    return true
  }

  return {
    events,
    token,
    turns,
    timeline,
    toolEvents,
    isRunning,
    isRetryPending,
    showThinkingTimeline,
    showToolActivity,
    cooldownRemainingMs,
    isCoolingDown,
    submitLabel,
    submitPrompt,
    resetConversation,
    cancelRetry
  }
}

export type SettingsSurfaceController = {
  effectiveStatus: SystemStatus
  refreshStatus: () => Promise<void>
  token: string | null
  clearToken: () => Promise<void>
  setToken: (token: string) => Promise<void>
  canStartGitHubOAuth: boolean
  startGitHubOAuth: () => void
  user: ReturnType<typeof useGitHubUser>
  models: ModelEntry[]
  selectedModel: string
  setSelectedModel: (model: string) => Promise<void>
  searchEnabled: boolean
  setSearchEnabled: (enabled: boolean) => Promise<void>
  showThinkingTimeline: boolean
  setShowThinkingTimeline: (show: boolean) => Promise<void>
  showToolActivity: boolean
  setShowToolActivity: (show: boolean) => Promise<void>
  searchUnavailable: boolean
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
  addMcpServer: (server: Omit<McpServerConfig, 'id'>) => Promise<McpServerConfig>
  updateMcpServer: (id: string, patch: Partial<Omit<McpServerConfig, 'id'>>) => Promise<void>
  removeMcpServer: (id: string) => Promise<void>
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>
  refreshMcpServer: (server: McpServerConfig) => Promise<void>
}

export const useSettingsSurfaceController = (): SettingsSurfaceController => {
  const status = useStatusStore((state) => state.status)
  const refreshStatus = useStatusStore((state) => state.refresh)
  const token = useAuthStore((state) => state.token)
  const clearToken = useAuthStore((state) => state.clearToken)
  const setToken = useAuthStore((state) => state.setToken)
  const { canStartGitHubOAuth, startGitHubOAuth } = useGitHubOAuth()
  const user = useGitHubUser()
  const models = useGitHubModels()
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)
  const searchEnabled = useSettingsStore((state) => state.searchEnabled)
  const setSearchEnabled = useSettingsStore((state) => state.setSearchEnabled)
  const showThinkingTimeline = useSettingsStore((state) => state.showThinkingTimeline)
  const setShowThinkingTimeline = useSettingsStore((state) => state.setShowThinkingTimeline)
  const showToolActivity = useSettingsStore((state) => state.showToolActivity)
  const setShowToolActivity = useSettingsStore((state) => state.setShowToolActivity)
  const mcpServers = useSettingsStore((state) => state.mcpServers)
  const mcpDiscovery = useSettingsStore((state) => state.mcpDiscovery)
  const addMcpServer = useSettingsStore((state) => state.addMcpServer)
  const updateMcpServer = useSettingsStore((state) => state.updateMcpServer)
  const removeMcpServer = useSettingsStore((state) => state.removeMcpServer)
  const setMcpServerEnabled = useSettingsStore((state) => state.setMcpServerEnabled)
  const setMcpDiscovery = useSettingsStore((state) => state.setMcpDiscovery)
  const clearMcpDiscovery = useSettingsStore((state) => state.clearMcpDiscovery)
  const { shell } = useBrowserApp()

  const effectiveStatus = status ?? OFFLINE_SYSTEM_STATUS

  const refreshMcpServer = async (server: McpServerConfig): Promise<void> => {
    await clearMcpDiscovery(server.id)
    try {
      const edgeFetch = createEdgeFetch(shell.config.edgeBaseUrl, () => token)
      const res = await edgeFetch('/api/mcp/discover', {
        url: server.url,
        bearerToken: server.bearerToken
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        const errMsg = (errBody as { error?: string }).error ?? `HTTP ${res.status}`
        await setMcpDiscovery({
          serverId: server.id,
          serverName: server.name,
          tools: [],
          syncedAt: new Date().toISOString(),
          error: errMsg
        })
        return
      }
      const raw = await res.json()
      const result = mcpDiscoveryResultSchema.parse({ ...raw, serverId: server.id })
      await setMcpDiscovery(result)
    } catch (e) {
      await setMcpDiscovery({
        serverId: server.id,
        serverName: server.name,
        tools: [],
        syncedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : 'Discovery failed'
      })
    }
  }

  return {
    effectiveStatus,
    refreshStatus,
    token,
    clearToken,
    setToken,
    canStartGitHubOAuth,
    startGitHubOAuth,
    user,
    models,
    selectedModel,
    setSelectedModel,
    searchEnabled,
    setSearchEnabled,
    showThinkingTimeline,
    setShowThinkingTimeline,
    showToolActivity,
    setShowToolActivity,
    searchUnavailable: effectiveStatus.search.state !== 'ready',
    mcpServers,
    mcpDiscovery,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    setMcpServerEnabled,
    refreshMcpServer
  }
}

export const useGitHubOAuthCallbackController = (
  onCompleteWithoutReturnUrl: () => void
): { error: string | null } => {
  const [error, setError] = useState<string | null>(null)
  const { completeGitHubOAuthCallback, consumeGitHubOAuthReturnUrl } = useGitHubOAuth()
  const handleCompleteWithoutReturnUrl = useEffectEvent(onCompleteWithoutReturnUrl)

  useEffect(() => {
    let isDisposed = false
    const params = new URLSearchParams(window.location.search)

    completeGitHubOAuthCallback({
      code: params.get('code'),
      state: params.get('state')
    })
      .then(() => {
        if (isDisposed) {
          return
        }

        const returnUrl = consumeGitHubOAuthReturnUrl()
        if (returnUrl) {
          window.location.replace(returnUrl)
          return
        }

        handleCompleteWithoutReturnUrl()
      })
      .catch((nextError: unknown) => {
        if (isDisposed) {
          return
        }

        setError(
          nextError instanceof Error && nextError.message
            ? nextError.message
            : 'Authentication failed. Please try again.'
        )
      })

    return () => {
      isDisposed = true
    }
  }, [completeGitHubOAuthCallback, consumeGitHubOAuthReturnUrl, handleCompleteWithoutReturnUrl])

  return { error }
}
