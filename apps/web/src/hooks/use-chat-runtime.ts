import { useEffect } from 'react'
import { useChatStore } from '../stores/chat-store'

export const useChatRuntime = () => {
  const store = useChatStore((state) => state)

  useEffect(() => {
    if (!store.conversationId) {
      void store.initialize()
    }
  }, [store])

  return store
}
