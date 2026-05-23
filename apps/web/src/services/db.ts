import { createDb, createChatRepository, createPreferencesRepository } from '@tinytinkerer/app-browser/db'

const db = createDb('tinytinkerer')
const chatRepo = createChatRepository(db)
const prefsRepo = createPreferencesRepository(db)

export const createConversation = () => chatRepo.createConversation()
export const getLatestConversation = () => chatRepo.getLatestConversation()
export const getLatestConversationOrCreate = () => chatRepo.getLatestConversationOrCreate()
export const loadConversationEvents = (conversationId: string) => chatRepo.loadConversationEvents(conversationId)
export const appendEvent = (event: import('@tinytinkerer/app-browser').PersistedEvent) => chatRepo.appendEvent(event)
export const clearConversationEvents = (conversationId: string) => chatRepo.clearConversationEvents(conversationId)
export const setPreference = (key: string, value: string) => prefsRepo.set(key, value)
export const getPreference = (key: string) => prefsRepo.get(key)
