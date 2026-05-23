import type { ConversationMessage } from '@tinytinkerer/agent-core'
import type { ChatEvent, SystemStatus } from '@tinytinkerer/contracts'

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type PersistedEvent = ChatEvent & {
  conversationId: string
}

export interface ConversationRepository {
  createConversation(): Promise<Conversation>
  getLatestConversation(): Promise<Conversation | undefined>
  loadConversationEvents(conversationId: string): Promise<PersistedEvent[]>
  appendEvent(event: PersistedEvent): Promise<void>
  clearConversationEvents(conversationId: string): Promise<void>
}

export interface PreferencesStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
}

export interface AuthTokenStore {
  getStoredToken(): Promise<string | null>
  setStoredToken(token: string): Promise<void>
  clearStoredToken(): Promise<void>
  getHostToken?(): string | null
}

export interface StatusGateway {
  fetchStatus(): Promise<SystemStatus>
}

export interface SearchGateway {
  search(query: string, maxResults?: number): Promise<unknown>
}

export interface ModelsGateway {
  streamResponse(
    prompt: string,
    history: ConversationMessage[],
    options?: { signal?: AbortSignal; searchEnabled?: boolean }
  ): AsyncIterable<string>
}

export interface ChatRuntime {
  run(
    prompt: string,
    options?: { signal?: AbortSignal; history?: ConversationMessage[] }
  ): AsyncGenerator<ChatEvent>
}

export interface ChatRuntimeFactory {
  create(): ChatRuntime
}
