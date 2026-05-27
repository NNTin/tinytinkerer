import { buildCurrentTimeline, buildTurns, type TimelineEntry, type Turn } from '@tinytinkerer/app-core'
import type { ChatEvent, SystemStatus } from '@tinytinkerer/contracts'
import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { useAuthStore, useChatStore, useSettingsStore, useStatusStore } from './app'
import { formatCooldown, useChatCooldown, useGitHubOAuth } from './hooks'
import { useGitHubUser } from './github-user'
import { useGitHubModels, type ModelEntry } from './github-models'
import { startStatusPolling } from './status'
import { OFFLINE_SYSTEM_STATUS } from './stores/status-store'

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

  const effectiveStatus = status ?? OFFLINE_SYSTEM_STATUS

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
    searchUnavailable: effectiveStatus.search.state !== 'ready'
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
