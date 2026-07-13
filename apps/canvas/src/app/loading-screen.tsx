import { LoadingStatusPanel } from '@tinytinkerer/app-browser'

export const CanvasBootScreen = ({ error }: { error?: string }) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Canvas Boot"
    title="Loading tinytinkerer"
    message="Starting the integrated canvas workspace."
    {...(error ? { error } : {})}
  />
)

export const CanvasRouteLoading = () => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Route Loading"
    title="Opening the canvas"
    message="Preparing the whiteboard stage."
  />
)

export const CanvasChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Chat Runtime"
    title="Hydrating the session"
    message="Loading the conversation controller."
    {...(error ? { error } : {})}
  />
)
