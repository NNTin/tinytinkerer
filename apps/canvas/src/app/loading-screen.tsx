import type { LoadingScreenProps } from '@tinytinkerer/app-browser'

const LoadingPanel = ({ eyebrow, title, message, error }: LoadingScreenProps) => (
  <div className="flex min-h-screen items-center justify-center px-4 py-6">
    <div className="w-full max-w-md rounded-[2rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] p-5 shadow-[0_24px_70px_rgba(36,33,24,0.14)]">
      <p className="text-[11px] uppercase tracking-[0.26em] text-[var(--widget-muted)]">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-xl font-semibold text-[var(--widget-text)]">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--widget-muted)]">{message}</p>
      {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}
    </div>
  </div>
)

export const CanvasBootScreen = ({ error }: { error?: string }) => (
  <LoadingPanel
    eyebrow="Canvas Boot"
    title="Loading tinytinkerer"
    message="Starting the chat shell and isolated whiteboard."
    {...(error ? { error } : {})}
  />
)

export const CanvasRouteLoading = () => (
  <LoadingPanel
    eyebrow="Route Loading"
    title="Opening the canvas"
    message="Preparing the whiteboard harness."
  />
)

export const CanvasChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingPanel
    eyebrow="Chat Runtime"
    title="Hydrating the session"
    message="Loading the conversation controller."
    {...(error ? { error } : {})}
  />
)
