import { LoadingStatusPanel } from '@tinytinkerer/app-browser'

export const IdeBootScreen = ({ error }: { error?: string }) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="IDE Boot"
    title="Loading TinyTinkerer IDE"
    message="Starting the browser workspace and assistant."
    {...(error ? { error } : {})}
  />
)

export const IdeRouteLoading = () => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Route Loading"
    title="Opening the IDE"
    message="Preparing the virtual workspace."
  />
)

export const IdeChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Chat Runtime"
    title="Hydrating the session"
    message="Loading the conversation controller."
    {...(error ? { error } : {})}
  />
)
