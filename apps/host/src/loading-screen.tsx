import { LoadingStatusPanel } from '@tinytinkerer/app-browser'

export const RootBootScreen = ({ error }: { error?: string }) => (
  <LoadingStatusPanel
    variant="host"
    eyebrow="Workspace Boot"
    title="Loading tinytinkerer"
    message="Bringing the shared chat App online across all three shells."
    idleMessage="Preparing the shared chat App."
    {...(error ? { error } : {})}
  />
)

export const RootChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingStatusPanel
    variant="host"
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, history, and client runtime."
    idleMessage="Preparing the shared chat App."
    {...(error ? { error } : {})}
  />
)
