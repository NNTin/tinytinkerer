type LoadingScreenProps = {
  eyebrow: string
  title: string
  message: string
  error?: string
}

const LoadingCard = ({ eyebrow, title, message, error }: LoadingScreenProps) => (
  <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-8 md:px-8">
    <div className="w-full max-w-xl rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_24px_80px_rgba(47,41,35,0.08)]">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 rounded-full bg-amber-400" />
        <span className="h-3 w-3 rounded-full bg-stone-300" />
        <span className="h-3 w-3 rounded-full bg-stone-300" />
      </div>
      <p className="mt-6 text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--text)]">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{message}</p>
      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
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
        <div className="mt-5 flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <span className="text-xs text-[var(--muted)]">Preparing the browser shell and local settings.</span>
        </div>
      )}
    </div>
  </div>
)

export const WebBootScreen = ({ error }: { error?: string }) => (
  <LoadingCard
    eyebrow="Workspace Boot"
    title="Loading tinytinkerer"
    message="Bringing the web shell online before the chat runtime hydrates."
    {...(error ? { error } : {})}
  />
)

export const WebRouteLoading = () => (
  <LoadingCard
    eyebrow="Route Loading"
    title="Opening the workspace"
    message="Fetching the next screen and its UI chrome."
  />
)

export const WebChatLoading = () => (
  <LoadingCard
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, history, and client runtime on demand."
  />
)

export const WebPanelLoading = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/12 px-4">
    <div className="w-full max-w-md rounded-[1.75rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_24px_80px_rgba(47,41,35,0.12)]">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Settings</p>
      <h2 className="mt-2 text-lg font-semibold text-[var(--text)]">Loading controls</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">Pulling in account, model, and MCP configuration UI.</p>
    </div>
  </div>
)
