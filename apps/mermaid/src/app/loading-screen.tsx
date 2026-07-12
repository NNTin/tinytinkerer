import { LoadingStatusPanel } from '@tinytinkerer/app-browser'
export const MermaidBootScreen = ({ error }: { error?: string }) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Mermaid Boot"
    title="Loading Mermaid workspace"
    message="Starting the diagram editor and assistant."
    {...(error ? { error } : {})}
  />
)
export const MermaidRouteLoading = () => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Route Loading"
    title="Opening Mermaid"
    message="Preparing the diagram workspace."
  />
)
export const MermaidChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Chat Runtime"
    title="Hydrating the session"
    message="Loading the conversation controller."
    {...(error ? { error } : {})}
  />
)
