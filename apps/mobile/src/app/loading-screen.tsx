type LoadingScreenProps = {
  eyebrow: string
  title: string
  message: string
  error?: string
}

const LoadingShell = ({ eyebrow, title, message, error }: LoadingScreenProps) => (
  <div className="flex min-h-[100dvh] w-full flex-col bg-[var(--bg)] px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)] text-[var(--text)]">
    <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_24px_60px_rgba(47,41,35,0.08)]">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">{eyebrow}</p>
        <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-[var(--muted)]">
          Mobile
        </span>
      </div>
      <h1 className="mt-3 text-2xl font-semibold text-stone-900">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{message}</p>
      {error ? (
        <div className="mt-5 rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
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
        <div className="mt-5 rounded-[1.5rem] border border-stone-200 bg-white px-4 py-4">
          <p className="text-xs text-[var(--muted)]">Loading shared browser state and preparing the mobile shell.</p>
        </div>
      )}
    </div>
  </div>
)

export const MobileBootScreen = ({ error }: { error?: string }) => (
  <LoadingShell
    eyebrow="PWA Boot"
    title="Loading tinytinkerer"
    message="Starting the installable shell before the chat runtime and history attach."
    {...(error ? { error } : {})}
  />
)

export const MobileRouteLoading = () => (
  <LoadingShell
    eyebrow="Route Loading"
    title="Opening the next screen"
    message="Fetching the requested route and its mobile UI."
  />
)

export const MobileChatLoading = () => (
  <LoadingShell
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, local history, and client-side tools."
  />
)

export const MobilePanelLoading = () => (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/18 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
    <div className="w-full max-w-screen-sm rounded-t-[2rem] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_-12px_40px_rgba(47,41,35,0.12)]">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Settings</p>
      <h2 className="mt-2 text-lg font-semibold text-stone-900">Loading controls</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">Bringing in account, model, and MCP settings.</p>
    </div>
  </div>
)
