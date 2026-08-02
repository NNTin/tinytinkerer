import {
  buildTurns,
  reconcileTurns,
  type ActivitySummarizer,
  type PluginManifest,
  type Turn
} from '@tinytinkerer/app-core'
import {
  EDGE_ROUTE_PATHS,
  mcpDiscoveryResultSchema,
  type AgentType,
  type ChatEvent,
  type McpDiscoveryResult,
  type McpServerConfig,
  type PluginActivationState,
  type PluginConfigState,
  type SystemStatus
} from '@tinytinkerer/contracts'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from 'react'
import { appToolCatalogue } from './app-tool-group'
import { usePluginModules } from './plugins/use-plugin-modules'
import { isMcpToolId, summarizeMcpActivity } from './runtime/mcp-tool'
import { toolLabel, type ResolveActivitySummarizer } from './turn-activity-panel'
import { useWebSpeechInput } from './web-speech'
import { useAuthStore, useBrowserApp, useChatStore, useSettingsStore, useStatusStore } from './app'
import { preSendDisclosureStoreFor } from './pre-send-disclosure'
import { MAX_CONCURRENT_RUNS } from './stores/chat-store'
import { formatCooldown, useChatCooldown, useGitHubOAuth } from './hooks'
import { useGitHubUser } from './github-user'
import { useModels, type ModelEntry } from './models'
import { readOAuthCallbackParams } from './oauth-callback-url'
import { startStatusPolling } from './status'
import { OFFLINE_SYSTEM_STATUS } from './stores/status-store'
import { createEdgeFetch } from './runtime/edge-fetch'
import { parseJsonWithTelemetry, parseWithTelemetry } from './telemetry/request-telemetry'
import { markOAuthCallbackHandled } from './telemetry/oauth-callback-handled'

export type ChatSurfaceController = {
  isBooting: boolean
  initializeError: string | null
  events: ChatEvent[]
  token: string | null
  turns: Turn[]
  serverNameById: Map<string, string>
  // Resolves a tool's owner-provided activity summarizer by id for the turn
  // activity panel. Plugin summarizers come from dynamically-discovered manifests;
  // MCP tools are summarized by the MCP layer keyed by the `mcp:*` id pattern.
  resolveActivitySummarizer: ResolveActivitySummarizer
  isRunning: boolean
  isRetryPending: boolean
  showReasoningActivity: boolean
  cooldownRemainingMs: number
  isCoolingDown: boolean
  submitLabel: string
  // Returns the decision synchronously so callers can clear the input the
  // moment a prompt is accepted, without waiting for the backend response. The
  // send itself runs in the background (issue #206).
  submitPrompt: (prompt: string) => SubmitPromptResult
  // Re-run the latest user prompt as a fresh generation, preserving history.
  // Backs the per-message "Regenerate" action (shared TurnActions).
  rerunLastPrompt: () => Promise<void>
  // True when there is a user turn to regenerate and the surface is idle.
  canRerun: boolean
  resetConversation: () => Promise<void>
  cancelRetry: () => void
  // Abort the in-flight generation. Surfaced as the "Stop" affordance whenever
  // `isRunning` is true.
  stop: () => void
  // Transient refusal notice (issue #430) set when submitPrompt refuses a send
  // because MAX_CONCURRENT_RUNS is already running elsewhere. Clears on the
  // next accepted submit, on switching the active conversation, and after a
  // few seconds — see useChatSurfaceController.
  sendRefusalNotice: string | null
}

/**
 * What one submit attempt did (issue #481).
 *
 * A discriminated result rather than a boolean, because "not sent" had grown two
 * meanings — refused outright, and held pending the reader's acknowledgement —
 * and the composer was telling them apart by comparing its own prompt text
 * against shared mutable gate state. Two surfaces submitting the same words
 * would have correlated with the wrong attempt.
 *
 * `held` carries its own outcome, so a caller waits on the attempt it made
 * rather than on "something was approved recently".
 *
 * That outcome is `admitted` — did this prompt actually get a run — and NOT
 * "did the reader accept the disclosure". The two come apart: the dialog can
 * sit open long enough for the cooldown, the re-entry latch or the concurrency
 * cap to change, and several sends can join one dialog and then compete for a
 * single run slot. Resolving on acceptance cleared the composer for prompts
 * that were never sent (issue #481 re-review, finding 3).
 */
export type SubmitPromptResult =
  | { status: 'sent' }
  | { status: 'held'; requestId: number; admitted: Promise<boolean> }
  | { status: 'refused' }

const SENT: SubmitPromptResult = { status: 'sent' }
const REFUSED: SubmitPromptResult = { status: 'refused' }

export const useChatSurfaceController = (): ChatSurfaceController => {
  const appToolGroup = useBrowserApp().appToolGroup
  const [initializeError, setInitializeError] = useState<string | null>(null)
  const hydrated = useChatStore((state) => state.hydrated)
  const events = useChatStore((state) => state.events)
  const isRunning = useChatStore((state) => state.isRunning)
  const isRetryPending = useChatStore((state) => state.isRetryPending)
  const initialize = useChatStore((state) => state.initialize)
  const sendPrompt = useChatStore((state) => state.sendPrompt)
  const rerunLastPrompt = useChatStore((state) => state.rerunLastPrompt)
  const stop = useChatStore((state) => state.stop)
  // Which of the two resets this app's control performs (issue #480). Both are
  // real store actions; the app declares which one its reader gets, so a surface
  // never has to know whose session it is rendering. The documentation assistant
  // picks `restart` — #479's locked "abort, discard, start fresh" — while every
  // product shell keeps clearing in place.
  const conversationReset = useBrowserApp().conversationReset
  const clearConversation = useChatStore((state) => state.resetConversation)
  const restartConversation = useChatStore((state) => state.restartConversation)
  const resetConversation =
    conversationReset === 'restart' ? restartConversation : clearConversation
  const cancelRetry = useChatStore((state) => state.cancelRetry)
  const refreshStatus = useStatusStore((state) => state.refresh)
  const token = useAuthStore((state) => state.token)
  const showReasoningActivity = useSettingsStore((state) => state.showReasoningActivity)
  const mcpServers = useSettingsStore((state) => state.mcpServers)
  const { cooldownRemainingMs, isCoolingDown } = useChatCooldown()

  // Still tracked internally (below: clears the refusal notice and resets the
  // turn-reconciliation baseline on conversation switch) even though it is no
  // longer part of this hook's public return value.
  const activeConversationId = useChatStore((state) => state.conversationId)
  const canStartRun = useChatStore((state) => state.canStartRun)
  // Read as a store handle rather than through a selector hook: `submitPrompt`
  // needs the state at submit time, and subscribing this controller to gate
  // state would re-render every chat surface each time the dialog opened.
  const preSendDisclosureStore = preSendDisclosureStoreFor(useBrowserApp())

  // Transient cap-refusal notice (issue #430): set by submitPrompt below when
  // canStartRun() refuses a send. Cleared on the next accepted submit, on
  // switching conversations, and after a few seconds.
  const [sendRefusalNotice, setSendRefusalNotice] = useState<string | null>(null)
  const refusalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearRefusalTimeout = () => {
    if (refusalTimeoutRef.current !== null) {
      clearTimeout(refusalTimeoutRef.current)
      refusalTimeoutRef.current = null
    }
  }
  // Unmount cleanup only — intentionally not in the conversation-switch effect
  // below (that effect already calls clearRefusalTimeout itself).
  useEffect(() => clearRefusalTimeout, [])
  useEffect(() => {
    setSendRefusalNotice(null)
    clearRefusalTimeout()
    // Only the conversation switch should clear the notice here; clearRefusalTimeout
    // is stable (redefined per render but side-effect-free to call redundantly).
  }, [activeConversationId])

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

  // buildTurns returns fresh Turn objects every time `events` changes (once per
  // streamed delta). Reconcile against the previous list so settled turns keep
  // their object identity, letting the memoized per-turn renderers skip them and
  // only the in-flight turn re-render (issue #340). Reusing the prior object for
  // an unchanged turn is idempotent, so this stays correct under StrictMode's
  // double-invocation.
  const previousTurnsRef = useRef<Turn[]>([])
  // Reset the reconciliation baseline on conversation switch (issue #430): the
  // previous list otherwise belongs to a DIFFERENT conversation. Turn ids are
  // event ids (globally unique), so cross-conversation identity reuse can't
  // actually happen — this is a cleanliness reset, not a correctness fix —
  // but starting a freshly-switched-to conversation from an empty baseline is
  // clearer than reconciling against an unrelated conversation's turns.
  const previousConversationIdRef = useRef(activeConversationId)
  if (previousConversationIdRef.current !== activeConversationId) {
    previousConversationIdRef.current = activeConversationId
    previousTurnsRef.current = []
  }
  const turns = useMemo(() => {
    const reconciled = reconcileTurns(previousTurnsRef.current, buildTurns(events))
    previousTurnsRef.current = reconciled
    return reconciled
  }, [events])
  const serverNameById = useMemo(
    () => new Map(mcpServers.map((server) => [server.id, server.name])),
    [mcpServers]
  )

  // Plugin-contributed activity summarizers, keyed by tool id. Derived from the
  // same dynamically-discovered plugin manifests the host already reads (via the
  // shared usePluginModules hook), so the panel stays free of any static dependency
  // on a concrete plugin package.
  const pluginModules = usePluginModules()
  const pluginSummarizers = useMemo(() => {
    const map = new Map<string, ActivitySummarizer>()
    for (const mod of pluginModules) {
      for (const descriptor of mod.manifest.toolDescriptors ?? []) {
        if (descriptor.summarizeActivity) {
          map.set(descriptor.id, descriptor.summarizeActivity)
        }
      }
    }
    return map
  }, [pluginModules])
  const appSummarizers = useMemo(
    () =>
      new Map(
        (appToolGroup ? appToolCatalogue(appToolGroup) : []).flatMap((tool) =>
          tool.summarizeActivity ? [[tool.id, tool.summarizeActivity] as const] : []
        )
      ),
    [appToolGroup]
  )

  // Resolve a tool's summarizer by id: a plugin descriptor's wins by exact id; an
  // `mcp:*` id falls back to the MCP layer's summarizer, bound here to the host's
  // resolved `[server] tool` label (which needs serverNameById); app-local tools
  // carry their summarizers on their concrete Tool instances. The order mirrors
  // runtime registration precedence (plugins, MCP, app).
  const resolveActivitySummarizer = useMemo<ResolveActivitySummarizer>(
    () => (toolId) => {
      const pluginSummarizer = pluginSummarizers.get(toolId)
      if (pluginSummarizer) {
        return pluginSummarizer
      }
      if (isMcpToolId(toolId)) {
        const title = toolLabel(toolId, serverNameById)
        return (output) => summarizeMcpActivity(title, output)
      }
      return appSummarizers.get(toolId)
    },
    [pluginSummarizers, appSummarizers, serverNameById]
  )

  const submitLabel = isCoolingDown
    ? formatCooldown(cooldownRemainingMs)
    : isRunning
      ? 'Thinking…'
      : 'Send'

  const submitPrompt = (prompt: string): SubmitPromptResult => {
    const trimmed = prompt.trim()
    if (!trimmed || isCoolingDown || isRunning) {
      return REFUSED
    }

    // Cap refusal (issue #430): MAX_CONCURRENT_RUNS conversations are already
    // running/mid-send elsewhere. Refuse visibly instead of falling through to
    // sendPrompt's silent no-op, and — matching the #206 clear-on-accept
    // contract — return false so the composer does NOT clear the input.
    if (!canStartRun()) {
      clearRefusalTimeout()
      setSendRefusalNotice(
        `Parallel run limit reached (${MAX_CONCURRENT_RUNS}). Stop or wait for another conversation to finish.`
      )
      refusalTimeoutRef.current = setTimeout(() => {
        setSendRefusalNotice(null)
        refusalTimeoutRef.current = null
      }, 6000)
      return REFUSED
    }
    if (sendRefusalNotice) {
      setSendRefusalNotice(null)
      clearRefusalTimeout()
    }

    // The pre-send disclosure (issue #481). Checked LAST, immediately before the
    // send, so a reader is never shown a data-flow dialog only to have the send
    // refused afterwards by the cooldown or the parallel-run cap.
    //
    // This is the composer's half of the gate, and it exists for ONE reason the
    // store-level check cannot cover: clear-on-accept. `sendPrompt` awaits the
    // same coordinator, so a send is safe either way — but if the composer had
    // cleared first and the reader then declined, their question would be gone.
    // So a held send reports itself as `held`, the input stays put, and the
    // decision carries the actual send.
    const gate = preSendDisclosureStore.getState()
    if (gate.isRequired()) {
      const { requestId, decided } = gate.request(trimmed)
      // Settled by whichever comes first: the run being committed
      // (`onAdmitted`), or the send resolving without ever committing. A
      // promise keeps its first settlement, so the `finally` below is a no-op
      // once admission has fired — and the ONLY path for a refused send.
      let settle: (admitted: boolean) => void = () => undefined
      const admitted = new Promise<boolean>((resolve) => {
        settle = resolve
      })
      void decided.then((allowed) => {
        if (!allowed) {
          settle(false)
          return
        }
        // Not awaited: `sendPrompt` resolves when the RUN finishes, and the
        // composer must clear as soon as the prompt is in — the same
        // clear-on-accept timing every unheld send gets (issue #206).
        void sendPrompt(trimmed, undefined, { onAdmitted: () => settle(true) }).finally(() =>
          settle(false)
        )
      })
      return { status: 'held', requestId, admitted }
    }

    // Kick off the send without awaiting the backend response so the caller can
    // clear the input immediately (issue #206). Errors continue to surface the
    // same way they did before — sendPrompt manages run state and emits
    // telemetry/events internally, so we deliberately do not await or catch here.
    void sendPrompt(trimmed)
    return SENT
  }

  return {
    isBooting: !hydrated && initializeError === null,
    initializeError,
    events,
    token,
    turns,
    serverNameById,
    resolveActivitySummarizer,
    isRunning,
    isRetryPending,
    showReasoningActivity,
    cooldownRemainingMs,
    isCoolingDown,
    submitLabel,
    submitPrompt,
    rerunLastPrompt,
    // Advisory UI hint for whether the Regenerate control should be enabled. The
    // single source of truth for whether a rerun actually runs is the store's
    // `rerunLastPrompt`, which re-checks the same gate as `sendPrompt`
    // (`latestUserPrompt` exists + not running + off cooldown) — this flag only
    // mirrors that so the button can disable ahead of the click. Keep the two in
    // sync: this must never permit a rerun the store would reject.
    canRerun: !isRunning && !isCoolingDown && turns.some((turn) => turn.userText.length > 0),
    resetConversation,
    cancelRetry,
    stop,
    sendRefusalNotice
  }
}

export type ChatComposer = {
  prompt: string
  setPrompt: Dispatch<SetStateAction<string>>
  speech: ReturnType<typeof useWebSpeechInput>
  /**
   * Validates the current prompt and, when accepted, kicks off the send and
   * clears the input immediately — so the user can keep typing the next message
   * while the agent is still working (issue #206). Sending stays blocked while
   * the agent is running or cooling down (enforced by submitPrompt). Returns
   * whether the prompt was accepted for sending right now; a prompt held for a
   * pre-send disclosure reports `false` and clears itself later, if approved.
   */
  handleSubmit: () => boolean
}

/**
 * Owns the prompt input state and the single source of truth for the
 * submit → clear-on-accept behavior shared by every chat surface (web, mobile,
 * widget). Surfaces consume this hook and only wire up their own UI; they must
 * not re-implement the validate-then-clear logic.
 */
export const useChatComposer = (
  submitPrompt: ChatSurfaceController['submitPrompt']
): ChatComposer => {
  const [prompt, setPrompt] = useState('')
  const speech = useWebSpeechInput({ prompt, setPrompt })

  const handleSubmit = (): boolean => {
    speech.stop()
    const result = submitPrompt(prompt)
    if (result.status === 'sent') {
      setPrompt('')
      return true
    }
    if (result.status === 'held') {
      // Held for the pre-send disclosure (issue #481). The input stays put so a
      // reader who declines still has their question, and clears only once THIS
      // attempt was actually admitted for sending — not merely acknowledged.
      // Acknowledgement is not admission: the cooldown or the run cap can have
      // moved while the dialog was open, and several joined sends can compete
      // for one slot.
      //
      // Waiting on the returned promise rather than on shared "what was approved
      // recently?" state is what makes that safe with several surfaces open: two
      // composers submitting identical text can no longer resume each other's
      // attempt.
      void result.admitted.then((admitted) => {
        if (admitted) setPrompt('')
      })
    }
    return false
  }

  return { prompt, setPrompt, speech, handleSubmit }
}

export type SettingsSurfaceController = {
  effectiveStatus: SystemStatus
  refreshStatus: () => Promise<void>
  token: string | null
  clearToken: () => Promise<void>
  setToken: (token: string) => Promise<void>
  // Whether ANY sign-in route exists here: this shell's own GitHub OAuth, or a
  // host-provided one (issue #480). Surfaces should gate on this rather than on
  // `canStartGitHubOAuth`, which is false for every `host-token` shell and left
  // the docs/embedded settings panel offering sign-in with no button under it.
  canSignIn: boolean
  /**
   * Start whichever sign-in this app has. Returns whether it actually started —
   * `false` means the deployment cannot begin one (no client id, no host
   * handler), which a surface must announce rather than swallow.
   */
  signIn: () => boolean
  /**
   * Whether a composer's sign-in affordance should open Settings instead of
   * calling {@link signIn}. True when this shell's own OAuth is the only route,
   * because that button has always lived in the Settings panel — keeping every
   * existing surface's two-step flow exactly as it was. A host-provided sign-in
   * starts from the affordance itself.
   */
  signInOpensSettings: boolean
  canStartGitHubOAuth: boolean
  startGitHubOAuth: () => void
  user: ReturnType<typeof useGitHubUser>
  models: ModelEntry[]
  isRefreshingModels: boolean
  modelsRefreshError: string | null
  refreshModels: () => Promise<ModelEntry[]>
  selectedModel: string
  setSelectedModel: (model: string) => Promise<void>
  litellmBaseUrl: string
  litellmBaseUrlError: string | null
  setLiteLLMBaseUrl: (baseUrl: string | null) => Promise<void>
  agentType: AgentType
  setAgentType: (agentType: AgentType) => Promise<void>
  webSpeechEnabled: boolean
  setWebSpeechEnabled: (enabled: boolean) => Promise<void>
  showReasoningActivity: boolean
  setShowReasoningActivity: (show: boolean) => Promise<void>
  showCodeBlockFullscreenButton: boolean
  setShowCodeBlockFullscreenButton: (show: boolean) => Promise<void>
  mcpServers: McpServerConfig[]
  mcpDiscovery: Record<string, McpDiscoveryResult>
  addMcpServer: (server: Omit<McpServerConfig, 'id'>) => Promise<McpServerConfig>
  updateMcpServer: (id: string, patch: Partial<Omit<McpServerConfig, 'id'>>) => Promise<void>
  removeMcpServer: (id: string) => Promise<void>
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>
  refreshMcpServer: (server: McpServerConfig) => Promise<void>
  telemetryEnabled: boolean
  setTelemetryEnabled: (enabled: boolean) => Promise<void>
  // Whether this app is the document's telemetry-consent controller (issue
  // #479). False only where another app in the same document owns the setting,
  // in which case the surface must not offer a control: `setTelemetryEnabled`
  // is a no-op there and `telemetryEnabled` is a namespace-local value that no
  // longer reflects the real one.
  telemetryControlAvailable: boolean
  availablePlugins: PluginManifest[]
  pluginActivation: PluginActivationState
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>
  pluginConfig: PluginConfigState
  setPluginSetting: (pluginId: string, key: string, value: string | boolean) => Promise<void>
}

export const useSettingsSurfaceController = (): SettingsSurfaceController => {
  const status = useStatusStore((state) => state.status)
  const refreshStatus = useStatusStore((state) => state.refresh)
  const token = useAuthStore((state) => state.token)
  const clearToken = useAuthStore((state) => state.clearToken)
  const setToken = useAuthStore((state) => state.setToken)
  const { canStartGitHubOAuth, startGitHubOAuth } = useGitHubOAuth()
  // A host-provided sign-in wins over this shell's own OAuth when present: an
  // embedder that supplies one has, by definition, decided where its readers
  // authenticate. It also reports whether the flow started, which OAuth cannot.
  const appSignIn = useBrowserApp().signIn
  const canSignIn = appSignIn !== undefined || canStartGitHubOAuth
  const signIn = useCallback((): boolean => {
    if (appSignIn) {
      return appSignIn()
    }
    if (!canStartGitHubOAuth) {
      return false
    }
    startGitHubOAuth()
    return true
  }, [appSignIn, canStartGitHubOAuth, startGitHubOAuth])
  const user = useGitHubUser()
  // Plugin manifests are discovered dynamically (via the shared usePluginModules
  // hook); the settings UI has no static dependency on any concrete plugin package.
  const pluginModules = usePluginModules()
  const availablePlugins = useMemo<PluginManifest[]>(
    () => pluginModules.map((mod) => mod.manifest),
    [pluginModules]
  )
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const {
    models,
    isRefreshing: isRefreshingModels,
    refreshError: modelsRefreshError,
    refreshModels
  } = useModels(selectedModel)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)
  const litellmBaseUrl = useSettingsStore((state) => state.litellmBaseUrl)
  const litellmBaseUrlError = useSettingsStore((state) => state.litellmBaseUrlError)
  const setLiteLLMBaseUrl = useSettingsStore((state) => state.setLiteLLMBaseUrl)
  const agentType = useSettingsStore((state) => state.agentType)
  const setAgentType = useSettingsStore((state) => state.setAgentType)
  const webSpeechEnabled = useSettingsStore((state) => state.webSpeechEnabled)
  const setWebSpeechEnabled = useSettingsStore((state) => state.setWebSpeechEnabled)
  const showReasoningActivity = useSettingsStore((state) => state.showReasoningActivity)
  const setShowReasoningActivity = useSettingsStore((state) => state.setShowReasoningActivity)
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
  const setMcpServerEnabled = useSettingsStore((state) => state.setMcpServerEnabled)
  const setMcpDiscovery = useSettingsStore((state) => state.setMcpDiscovery)
  const clearMcpDiscovery = useSettingsStore((state) => state.clearMcpDiscovery)
  const telemetryEnabled = useSettingsStore((state) => state.telemetryEnabled)
  const setTelemetryEnabled = useSettingsStore((state) => state.setTelemetryEnabled)
  const pluginActivation = useSettingsStore((state) => state.pluginActivation)
  const setPluginEnabled = useSettingsStore((state) => state.setPluginEnabled)
  const pluginConfig = useSettingsStore((state) => state.pluginConfig)
  const setPluginSetting = useSettingsStore((state) => state.setPluginSetting)
  const { shell, documentGlobals } = useBrowserApp()

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
    canSignIn,
    signIn,
    signInOpensSettings: appSignIn === undefined,
    canStartGitHubOAuth,
    startGitHubOAuth,
    user,
    models,
    isRefreshingModels,
    modelsRefreshError,
    refreshModels,
    selectedModel,
    setSelectedModel,
    litellmBaseUrl,
    litellmBaseUrlError,
    setLiteLLMBaseUrl,
    agentType,
    setAgentType,
    webSpeechEnabled,
    setWebSpeechEnabled,
    showReasoningActivity,
    setShowReasoningActivity,
    showCodeBlockFullscreenButton,
    setShowCodeBlockFullscreenButton,
    mcpServers,
    mcpDiscovery,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    setMcpServerEnabled,
    refreshMcpServer,
    telemetryEnabled,
    setTelemetryEnabled,
    telemetryControlAvailable: documentGlobals.telemetry,
    availablePlugins,
    pluginActivation,
    setPluginEnabled,
    pluginConfig,
    setPluginSetting
  }
}

export const useGitHubOAuthCallbackController = (
  onCompleteWithoutReturnUrl: () => void
): { error: string | null } => {
  const [error, setError] = useState<string | null>(null)
  const { completeGitHubOAuthCallback, consumeGitHubOAuthReturnUrl } = useGitHubOAuth()
  const handleCompleteWithoutReturnUrl = useEffectEvent(onCompleteWithoutReturnUrl)

  useEffect(() => {
    // Mark the OAuth callback watchdog (armed at boot on any URL carrying an
    // OAuth code) as handled the moment this controller mounts — before reading
    // params or awaiting the exchange — so a mounted controller always defuses
    // the "no handler ran" backstop, regardless of whether the exchange itself
    // later succeeds or fails (those outcomes have their own captures).
    markOAuthCallbackHandled()

    let isDisposed = false
    // The redirect_uri every shell registers is hash-routed ('…/#/auth/callback'),
    // so GitHub's code/state can land in the hash fragment's query part rather
    // than window.location.search — see oauth-callback-url.ts.
    const params = readOAuthCallbackParams()

    completeGitHubOAuthCallback({
      code: params.code,
      state: params.state
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
