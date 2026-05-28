import type { LoadingScreenProps } from '@tinytinkerer/app-browser'

const LoadingPanel = ({ eyebrow, title, message, error }: LoadingScreenProps) => (
  <div className="flex min-h-screen items-center justify-center px-4 py-6">
    <div className="w-full max-w-md rounded-[2rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] p-5 shadow-[0_24px_70px_rgba(36,33,24,0.14)]">
      <p className="text-[11px] uppercase tracking-[0.26em] text-[var(--widget-muted)]">{eyebrow}</p>
      <h1 className="mt-2 text-xl font-semibold text-[var(--widget-text)]">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--widget-muted)]">{message}</p>
      {error ? (
        <div className="mt-4 rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
          <p className="font-medium">Startup failed</p>
          <p className="mt-1">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700"
          >
            Reload
          </button>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-3 rounded-[1.5rem] border border-[var(--widget-border)] bg-white px-4 py-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <span className="text-xs text-[var(--widget-muted)]">Preparing the widget shell and local state.</span>
        </div>
      )}
    </div>
  </div>
)

export const WidgetBootScreen = ({ error }: { error?: string }) => (
  <LoadingPanel
    eyebrow="Widget Boot"
    title="Loading tinytinkerer"
    message="Starting the shared browser shell before the compact chat surface mounts."
    {...(error ? { error } : {})}
  />
)

export const WidgetRouteLoading = () => (
  <LoadingPanel
    eyebrow="Route Loading"
    title="Opening the widget"
    message="Fetching the requested route and widget controls."
  />
)

export const WidgetChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingPanel
    eyebrow="Chat Runtime"
    title="Hydrating the compact session"
    message="Loading the conversation controller and lazy client runtime."
    {...(error ? { error } : {})}
  />
)
