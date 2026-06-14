import type {
  AuthTokenStore,
  ConversationRepository,
  PreferencesStore,
  StatusGateway
} from '@tinytinkerer/app-core'
import type { SystemStatus } from '@tinytinkerer/contracts'
import {
  resolveBrowserShellConfig,
  type BrowserShellConfig,
  type ResolvedBrowserShellConfig
} from './config'
import { getTelemetryHeaders } from './telemetry/telemetry'
import {
  fetchWithTelemetry,
  parseJsonWithTelemetry,
  parseWithTelemetry,
  type RequestTelemetryMetadata
} from './telemetry/request-telemetry'

export type BrowserShell = {
  config: ResolvedBrowserShellConfig
  conversations: ConversationRepository
  preferences: PreferencesStore
  authTokens: AuthTokenStore
  statusGateway: StatusGateway
}

const isServiceStatus = (value: unknown): value is SystemStatus['auth'] => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  const state = record.state
  return (
    (state === 'ready' || state === 'degraded' || state === 'offline') &&
    typeof record.detail === 'string' &&
    (record.error === undefined || typeof record.error === 'string')
  )
}

const toSystemStatus = (value: unknown): SystemStatus => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Edge status response was not an object')
  }

  const record = value as Record<string, unknown>
  if (
    !isServiceStatus(record.auth) ||
    !isServiceStatus(record.models)
  ) {
    throw new Error('Edge status response was malformed')
  }

  return {
    auth: record.auth,
    models: record.models
  }
}

const createStatusGateway = (config: ResolvedBrowserShellConfig): StatusGateway => ({
  async fetchStatus() {
    const metadata: RequestTelemetryMetadata = {
      area: 'status.health',
      origin: 'edge',
      method: 'GET',
      url: `${config.edgeBaseUrl}/health`,
      // A transient network failure (offline, flaky Wi-Fi, DNS hiccup) on this
      // background health poll to our own edge is normal & unavoidable and not a
      // bug — the gateway already throws and the status store retries. We still
      // capture http_error (a real edge 5xx) so an actual outage surfaces.
      accept: {
        kinds: ['network_error'],
        reason:
          'Background health poll; transient client-side network failure to the edge is expected (TINYTINKERER-FRONTEND-8).'
      }
    }
    const response = await fetchWithTelemetry(metadata, {
      headers: getTelemetryHeaders()
    })
    if (!response.ok) {
      throw new Error('Unable to reach edge status endpoint')
    }

    const payload = await parseJsonWithTelemetry<unknown>(metadata, response)
    return parseWithTelemetry(
      metadata,
      'schema_error',
      'Edge status response was malformed',
      () => toSystemStatus(payload),
      response
    )
  }
})

const createLazyPersistence = (
  storageNamespace: string,
  hostToken: string | null
): Pick<BrowserShell, 'conversations' | 'preferences' | 'authTokens'> => {
  let persistencePromise:
    | Promise<{
        conversations: ConversationRepository
        preferences: PreferencesStore
        authTokens: AuthTokenStore
      }>
    | null = null

  const loadPersistence = async () => {
    persistencePromise ??= import('./db')
      .then(({ createBrowserPersistence }) =>
        createBrowserPersistence(storageNamespace, hostToken)
      )
      .catch((error) => {
        persistencePromise = null
        throw error
      })
    return persistencePromise
  }

  const preferences: PreferencesStore = {
    async get(key) {
      return (await loadPersistence()).preferences.get(key)
    },
    async set(key, value) {
      await (await loadPersistence()).preferences.set(key, value)
    }
  }

  const conversations: ConversationRepository = {
    async createConversation() {
      return (await loadPersistence()).conversations.createConversation()
    },
    async getLatestConversation() {
      return (await loadPersistence()).conversations.getLatestConversation()
    },
    async loadConversationEvents(conversationId) {
      return (await loadPersistence()).conversations.loadConversationEvents(conversationId)
    },
    async appendEvent(event) {
      await (await loadPersistence()).conversations.appendEvent(event)
    },
    async clearConversationEvents(conversationId) {
      await (await loadPersistence()).conversations.clearConversationEvents(conversationId)
    }
  }

  const authTokens: AuthTokenStore = {
    async getStoredToken() {
      return (await loadPersistence()).authTokens.getStoredToken()
    },
    async setStoredToken(token) {
      await (await loadPersistence()).authTokens.setStoredToken(token)
    },
    async clearStoredToken() {
      await (await loadPersistence()).authTokens.clearStoredToken()
    },
    getHostToken() {
      return hostToken
    }
  }

  return { conversations, preferences, authTokens }
}

export const createBrowserShell = (config: BrowserShellConfig): BrowserShell => {
  const resolved = resolveBrowserShellConfig(config)
  const persistence = createLazyPersistence(resolved.storageNamespace, resolved.hostToken)

  return {
    config: resolved,
    conversations: persistence.conversations,
    preferences: persistence.preferences,
    authTokens: persistence.authTokens,
    statusGateway: createStatusGateway(resolved)
  }
}
