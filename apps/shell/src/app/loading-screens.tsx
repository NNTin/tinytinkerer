import type { LoadingScreenProps } from '@tinytinkerer/app-browser'

// The three presentations' boot/route/chat/panel loading screens, previously one
// file per app (apps/web|widget|mobile). They live together here now that a single
// shell serves all three; each set keeps its distinct chrome and is selected by the
// presentation descriptor (src/presentations.tsx). The per-presentation palette is
// applied globally via html[data-shell] (see index.css), so these use the shared
// design tokens.

// ---------------------------------------------------------------------------
// Web — centered workspace card.
// ---------------------------------------------------------------------------

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
          <span className="text-xs text-[var(--muted)]">
            Preparing the browser shell and local settings.
          </span>
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

export const WebChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingCard
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, history, and client runtime on demand."
    {...(error ? { error } : {})}
  />
)

export const WebPanelLoading = () => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/12 px-4">
    <div className="w-full max-w-md rounded-[1.75rem] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_24px_80px_rgba(47,41,35,0.12)]">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Settings</p>
      <h2 className="mt-2 text-lg font-semibold text-[var(--text)]">Loading controls</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Pulling in account, model, and MCP configuration UI.
      </p>
    </div>
  </div>
)

// ---------------------------------------------------------------------------
// Widget — compact panel.
// ---------------------------------------------------------------------------

const LoadingPanel = ({ eyebrow, title, message, error }: LoadingScreenProps) => (
  <div className="flex min-h-screen items-center justify-center px-4 py-6">
    <div className="w-full max-w-md rounded-[2rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] p-5 shadow-[0_24px_70px_rgba(36,33,24,0.14)]">
      <p className="text-[11px] uppercase tracking-[0.26em] text-[var(--widget-muted)]">
        {eyebrow}
      </p>
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
          <span className="text-xs text-[var(--widget-muted)]">
            Preparing the widget shell and local state.
          </span>
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

// ---------------------------------------------------------------------------
// Mobile — full-viewport shell with safe-area insets.
// ---------------------------------------------------------------------------

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
          <p className="text-xs text-[var(--muted)]">
            Loading shared browser state and preparing the mobile shell.
          </p>
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

export const MobileChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingShell
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, local history, and client-side tools."
    {...(error ? { error } : {})}
  />
)

export const MobilePanelLoading = () => (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/18 px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
    <div className="w-full max-w-screen-sm rounded-t-[2rem] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_-12px_40px_rgba(47,41,35,0.12)]">
      <p className="text-[11px] uppercase tracking-[0.24em] text-[var(--muted)]">Settings</p>
      <h2 className="mt-2 text-lg font-semibold text-stone-900">Loading controls</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Bringing in account, model, and MCP settings.
      </p>
    </div>
  </div>
)
