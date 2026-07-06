import type { ChatEvent, SystemStatus } from '@tinytinkerer/contracts'
import type { ConversationMessage } from './runtime'

export type Conversation = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export type PersistedEvent = ChatEvent & {
  conversationId: string
}

// Deterministic replay order for persisted events: timestamp (ISO-8601 sorts
// lexicographically), then `seq` to break same-millisecond ties (legacy events
// without seq keep their timestamp position, sorting before seq-bearing ones),
// then id as a final deterministic tiebreak (issue #333).
export const compareEventOrder = (a: ChatEvent, b: ChatEvent): number => {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp < b.timestamp ? -1 : 1
  }
  const aSeq = a.seq ?? -1
  const bSeq = b.seq ?? -1
  if (aSeq !== bSeq) {
    return aSeq - bSeq
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
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
    options?: { signal?: AbortSignal }
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
