import { useChatStore } from '@tinytinkerer/app-browser'

export type RequestAssistantAction = (prompt: string) => void | Promise<void>

// First-class stage-to-assistant seam. Stages receive the returned callback instead
// of reaching through BrowserApp and coupling themselves to its store topology.
export const useRequestAssistantAction = (): RequestAssistantAction =>
  useChatStore((state) => state.sendPrompt)
