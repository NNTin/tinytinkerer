import type { LoadingScreenProps } from '@tinytinkerer/app-browser'

const LoadingCard = ({ eyebrow, title, message, error }: LoadingScreenProps) => (
  <div className="flex h-full w-full items-center justify-center px-4 py-8">
    <div className="w-full max-w-md rounded-[1.75rem] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_24px_80px_rgba(47,41,35,0.08)]">
      <p className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">{eyebrow}</p>
      <h1 className="mt-2 text-xl font-semibold text-[var(--text)]">{title}</h1>
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
          <span className="text-xs text-[var(--muted)]">Preparing the shared chat App.</span>
        </div>
      )}
    </div>
  </div>
)

export const RootBootScreen = ({ error }: { error?: string }) => (
  <LoadingCard
    eyebrow="Workspace Boot"
    title="Loading tinytinkerer"
    message="Bringing the shared chat App online across all three shells."
    {...(error ? { error } : {})}
  />
)

export const RootChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingCard
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, history, and client runtime."
    {...(error ? { error } : {})}
  />
)
