import { buildTurns, type PluginManifest, type Turn } from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  mcpDiscoveryResultSchema,
  type AgentType,
  type ChatEvent,
  type McpDiscoveryResult,
  type McpServerConfig,
  type ModelProviderId,
  type PluginActivationState,
  type SystemStatus
} from '@tinytinkerer/contracts'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { loadPluginModules } from './plugins/registry'
import {
  useAuthStore,
  useBrowserApp,
  useChatStore,
  useSettingsStore,
  useStatusStore
} from './app'
import { formatCooldown, useChatCooldown, useGitHubOAuth } from './hooks'
import { useGitHubUser } from './github-user'
import { useGitHubModels, type ModelEntry } from './github-models'
import { startStatusPolling } from './status'
import { OFFLINE_SYSTEM_STATUS } from './stores/status-store'
import { createEdgeFetch } from './runtime/edge-fetch'
import {
  parseJsonWithTelemetry,
  parseWithTelemetry
} from './telemetry/request-telemetry'

export type ChatSurfaceController = {
  isBooting: boolean
  initializeError: string | null
  events: ChatEvent[]
  token: string | null
  turns: Turn[]
  serverNameById: Map<string, string>
  isRunning: boolean
  isRetryPending: boolean
  showReasoningActivity: boolean
  cooldownRemainingMs: number
  isCoolingDown: boolean
  submitLabel: string
  submitPrompt: (prompt: string) => Promise<boolean>
  resetConversation: () => Promise<void>
  cancelRetry: () => void
}

export const useChatSurfaceController = (): ChatSurfaceController => {
  const [initializeError, setInitializeError] = useState<string | null>(null)
  const hydrated = useChatStore((state) => state.hydrated)
  const events = useChatStore((state) => state.events)
  const isRunning = useChatStore((state) => state.isRunning)
  const isRetryPending = useChatStore((state) => state.isRetryPending)
  const initialize = useChatStore((state) => state.initialize)
  const sendPrompt = useChatStore((state) => state.sendPrompt)
  const resetConversation = useChatStore((state) => state.resetConversation)
  const cancelRetry = useChatStore((state) => state.cancelRetry)
  const refreshStatus = useStatusStore((state) => state.refresh)
  const token = useAuthStore((state) => state.token)
  const showReasoningActivity = useSettingsStore(
    (state) => state.showReasoningActivity
  )
  const mcpServers = useSettingsStore((state) => state.mcpServers)
  const { cooldownRemainingMs, isCoolingDown } = useChatCooldown()

  useEffect(() => {
    if (hydrated || initializeError) {
      return
    }

    let cancelled = false

    void initialize().catch((error: unknown) => {
      if (cancelled) {
        return
      }

      setInitializeError(
        error instanceof Error && error.message
          ? error.message
          : 'Unable to initialize chat runtime.'
      )
    })

    return () => {
      cancelled = true
    }
  }, [hydrated, initialize, initializeError])

  useEffect(() => startStatusPolling(refreshStatus), [refreshStatus])

  const turns = useMemo(() => buildTurns(events), [events])
  const serverNameById = useMemo(
    () => new Map(mcpServers.map((server) => [server.id, server.name])),
    [mcpServers]
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
    isBooting: !hydrated && initializeError === null,
    initializeError,
    events,
    token,
    turns,
    serverNameById,
    isRunning,
    isRetryPending,
    showReasoningActivity,
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
  isRefreshingModels: boolean
  modelsRefreshError: string | null
  refreshGitHubModels: () => Promise<ModelEntry[]>
  selectedModelProvider: ModelProviderId
  setSelectedModelProvider: (provider: ModelProviderId) => Promise<void>
  selectedModel: string
  setSelectedModel: (model: string) => Promise<void>
  openRouterApiKey: string | null
  setOpenRouterApiKey: (apiKey: string | null) => Promise<void>
  agentType: AgentType
  setAgentType: (agentType: AgentType) => Promise<void>
  searchEnabled: boolean
  setSearchEnabled: (enabled: boolean) => Promise<void>
  webSpeechEnabled: boolean
  setWebSpeechEnabled: (enabled: boolean) => Promise<void>
  showReasoningActivity: boolean
  setShowReasoningActivity: (show: boolean) => Promise<void>
  showCodeBlockFullscreenButton: boolean
  setShowCodeBlockFullscreenButton: (show: boolean) => Promise<void>
  searchUnavailable: boolean
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
  addMcpServer: (
    server: Omit<McpServerConfig, 'id'>
  ) => Promise<McpServerConfig>
  updateMcpServer: (
    id: string,
    patch: Partial<Omit<McpServerConfig, 'id'>>
  ) => Promise<void>
  removeMcpServer: (id: string) => Promise<void>
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>
  refreshMcpServer: (server: McpServerConfig) => Promise<void>
  telemetryEnabled: boolean
  setTelemetryEnabled: (enabled: boolean) => Promise<void>
  availablePlugins: PluginManifest[]
  pluginActivation: PluginActivationState
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>
}

export const useSettingsSurfaceController = (): SettingsSurfaceController => {
  const status = useStatusStore((state) => state.status)
  const refreshStatus = useStatusStore((state) => state.refresh)
  const token = useAuthStore((state) => state.token)
  const clearToken = useAuthStore((state) => state.clearToken)
  const setToken = useAuthStore((state) => state.setToken)
  const { canStartGitHubOAuth, startGitHubOAuth } = useGitHubOAuth()
  const user = useGitHubUser()
  // Plugin manifests are discovered dynamically (see ./plugins/registry); the
  // settings UI has no static dependency on any concrete plugin package.
  const [availablePlugins, setAvailablePlugins] = useState<PluginManifest[]>([])
  useEffect(() => {
    let cancelled = false
    void loadPluginModules().then((modules) => {
      if (!cancelled) {
        setAvailablePlugins(modules.map((mod) => mod.manifest))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  const selectedModelProvider = useSettingsStore(
    (state) => state.selectedModelProvider
  )
  const setSelectedModelProvider = useSettingsStore(
    (state) => state.setSelectedModelProvider
  )
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const {
    models,
    isRefreshing: isRefreshingModels,
    refreshError: modelsRefreshError,
    refreshGitHubModels
  } = useGitHubModels(selectedModel)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)
  const openRouterApiKey = useSettingsStore((state) => state.openRouterApiKey)
  const setOpenRouterApiKey = useSettingsStore(
    (state) => state.setOpenRouterApiKey
  )
  const agentType = useSettingsStore((state) => state.agentType)
  const setAgentType = useSettingsStore((state) => state.setAgentType)
  const searchEnabled = useSettingsStore((state) => state.searchEnabled)
  const setSearchEnabled = useSettingsStore((state) => state.setSearchEnabled)
  const webSpeechEnabled = useSettingsStore((state) => state.webSpeechEnabled)
  const setWebSpeechEnabled = useSettingsStore(
    (state) => state.setWebSpeechEnabled
  )
  const showReasoningActivity = useSettingsStore(
    (state) => state.showReasoningActivity
  )
  const setShowReasoningActivity = useSettingsStore(
    (state) => state.setShowReasoningActivity
  )
  const showCodeBlockFullscreenButton = useSettingsStore(
    (state) => state.showCodeBlockFullscreenButton
  )
  const setShowCodeBlockFullscreenButton = useSettingsStore(
    (state) => state.setShowCodeBlockFullscreenButton
  )
  const mcpServers = useSettingsStore((state) => state.mcpServers)
  const mcpDiscovery = useSettingsStore((state) => state.mcpDiscovery)
  const addMcpServer = useSettingsStore((state) => state.addMcpServer)
  const updateMcpServer = useSettingsStore((state) => state.updateMcpServer)
  const removeMcpServer = useSettingsStore((state) => state.removeMcpServer)
  const setMcpServerEnabled = useSettingsStore(
    (state) => state.setMcpServerEnabled
  )
  const setMcpDiscovery = useSettingsStore((state) => state.setMcpDiscovery)
  const clearMcpDiscovery = useSettingsStore((state) => state.clearMcpDiscovery)
  const telemetryEnabled = useSettingsStore((state) => state.telemetryEnabled)
  const setTelemetryEnabled = useSettingsStore(
    (state) => state.setTelemetryEnabled
  )
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const setPluginEnabled = useSettingsStore((state) => state.setPluginEnabled)
  const { shell } = useBrowserApp()

  const effectiveStatus = status ?? OFFLINE_SYSTEM_STATUS

  const refreshMcpServer = async (server: McpServerConfig): Promise<void> => {
    await clearMcpDiscovery(server.id)
    try {
      const edgeFetch = createEdgeFetch(shell.config.edgeBaseUrl, () => token)
      const res = await edgeFetch(
        EDGE_ROUTE_PATHS.mcpDiscover,
        {
          url: server.url,
          bearerToken: server.bearerToken
        },
        { area: 'mcp.discover' }
      )
      if (!res.ok) {
        const errBody =
          (await parseJsonWithTelemetry<Record<string, unknown> | undefined>(
            {
              area: 'mcp.discover',
              origin: 'edge',
              method: 'POST',
              url: res.url
            },
            res.clone()
          ).catch(() => undefined)) ?? {}
        const errMsg =
          (errBody as { error?: string }).error ?? `HTTP ${res.status}`
        await setMcpDiscovery({
          serverId: server.id,
          serverName: server.name,
          tools: [],
          syncedAt: new Date().toISOString(),
          error: errMsg
        })
        return
      }
      const metadata = {
        area: 'mcp.discover' as const,
        origin: 'edge' as const,
        method: 'POST',
        url: res.url
      }
      const raw = await parseJsonWithTelemetry<unknown>(metadata, res)
      const result = parseWithTelemetry(
        metadata,
        'schema_error',
        'MCP discovery response did not match schema',
        () =>
          mcpDiscoveryResultSchema.parse({
            ...(raw as object),
            serverId: server.id
          }),
        res
      )
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
    isRefreshingModels,
    modelsRefreshError,
    refreshGitHubModels,
    selectedModelProvider,
    setSelectedModelProvider,
    selectedModel,
    setSelectedModel,
    openRouterApiKey,
    setOpenRouterApiKey,
    agentType,
    setAgentType,
    searchEnabled,
    setSearchEnabled,
    webSpeechEnabled,
    setWebSpeechEnabled,
    showReasoningActivity,
    setShowReasoningActivity,
    showCodeBlockFullscreenButton,
    setShowCodeBlockFullscreenButton,
    searchUnavailable: effectiveStatus.search.state !== 'ready',
    mcpServers,
    mcpDiscovery,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    setMcpServerEnabled,
    refreshMcpServer,
    telemetryEnabled,
    setTelemetryEnabled,
    availablePlugins,
    pluginActivation,
    setPluginEnabled
  }
}

export const useGitHubOAuthCallbackController = (
  onCompleteWithoutReturnUrl: () => void
): { error: string | null } => {
  const [error, setError] = useState<string | null>(null)
  const { completeGitHubOAuthCallback, consumeGitHubOAuthReturnUrl } =
    useGitHubOAuth()
  const handleCompleteWithoutReturnUrl = useEffectEvent(
    onCompleteWithoutReturnUrl
  )

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
  }, [
    completeGitHubOAuthCallback,
    consumeGitHubOAuthReturnUrl,
    handleCompleteWithoutReturnUrl
  ])

  return { error }
}
