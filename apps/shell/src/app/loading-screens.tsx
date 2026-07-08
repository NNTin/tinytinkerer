import { LoadingStatusPanel } from '@tinytinkerer/app-browser'

// The three presentations' boot/route/chat/panel loading screens, previously one
// file per app (apps/web|widget|mobile). They live together here now that a single
// shell serves all three; each set keeps its distinct copy and is selected by the
// presentation descriptor (src/presentations.tsx). The per-presentation palette is
// applied globally via html[data-shell] (see index.css), so these use the shared
// design tokens. The shared card/error/idle chrome itself lives in
// @tinytinkerer/app-browser's LoadingStatusPanel — this file only supplies each
// presentation's variant and copy.

// ---------------------------------------------------------------------------
// Web — centered workspace card.
// ---------------------------------------------------------------------------

export const WebBootScreen = ({ error }: { error?: string }) => (
  <LoadingStatusPanel
    variant="workspace"
    eyebrow="Workspace Boot"
    title="Loading tinytinkerer"
    message="Bringing the web shell online before the chat runtime hydrates."
    idleMessage="Preparing the browser shell and local settings."
    {...(error ? { error } : {})}
  />
)

export const WebRouteLoading = () => (
  <LoadingStatusPanel
    variant="workspace"
    eyebrow="Route Loading"
    title="Opening the workspace"
    message="Fetching the next screen and its UI chrome."
    idleMessage="Preparing the browser shell and local settings."
  />
)

export const WebChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingStatusPanel
    variant="workspace"
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, history, and client runtime on demand."
    idleMessage="Preparing the browser shell and local settings."
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

export const WidgetBootScreen = ({ error }: { error?: string }) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Widget Boot"
    title="Loading tinytinkerer"
    message="Starting the shared browser shell before the compact chat surface mounts."
    idleMessage="Preparing the widget shell and local state."
    {...(error ? { error } : {})}
  />
)

export const WidgetRouteLoading = () => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Route Loading"
    title="Opening the widget"
    message="Fetching the requested route and widget controls."
    idleMessage="Preparing the widget shell and local state."
  />
)

export const WidgetChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingStatusPanel
    variant="widget"
    eyebrow="Chat Runtime"
    title="Hydrating the compact session"
    message="Loading the conversation controller and lazy client runtime."
    idleMessage="Preparing the widget shell and local state."
    {...(error ? { error } : {})}
  />
)

// ---------------------------------------------------------------------------
// Mobile — full-viewport shell with safe-area insets.
// ---------------------------------------------------------------------------

export const MobileBootScreen = ({ error }: { error?: string }) => (
  <LoadingStatusPanel
    variant="mobile"
    eyebrow="PWA Boot"
    title="Loading tinytinkerer"
    message="Starting the installable shell before the chat runtime and history attach."
    idleMessage="Loading shared browser state and preparing the mobile shell."
    {...(error ? { error } : {})}
  />
)

export const MobileRouteLoading = () => (
  <LoadingStatusPanel
    variant="mobile"
    eyebrow="Route Loading"
    title="Opening the next screen"
    message="Fetching the requested route and its mobile UI."
    idleMessage="Loading shared browser state and preparing the mobile shell."
  />
)

export const MobileChatLoading = ({ error }: { error?: string } = {}) => (
  <LoadingStatusPanel
    variant="mobile"
    eyebrow="Chat Runtime"
    title="Hydrating the conversation"
    message="Loading the chat controller, local history, and client-side tools."
    idleMessage="Loading shared browser state and preparing the mobile shell."
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
