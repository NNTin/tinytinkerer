import type { LoadingScreenProps } from './loading-screen-types'

// The single boot/route/chat "loading status" panel shared by every browser
// shell (apps/shell's web/widget/mobile presentations, apps/host's root
// compositor, and the integrated application shells). Previously each app kept its
// own copy-pasted card + error/idle chrome, which let apps/canvas's copy drift
// and lose its "Startup failed" + Reload affordance (#370). Each app now
// supplies only the per-variant chrome via `variant`, plus copy via
// eyebrow/title/message/error/idleMessage.

export type LoadingStatusPanelVariant = 'workspace' | 'host' | 'widget' | 'mobile'

export type LoadingStatusPanelProps = LoadingScreenProps & {
  variant: LoadingStatusPanelVariant
  idleMessage?: string
  /** Recovery action for the error block's Reload button; defaults to a full page reload. */
  onReload?: () => void
}

type VariantChrome = {
  outer: string
  card: string
  eyebrow: string
  title: string
  message: string
  errorBox: string
}

const VARIANT_CHROME: Record<LoadingStatusPanelVariant, VariantChrome> = {
  workspace: {
    outer:
      'mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-8 md:px-8',
    card: 'w-full max-w-xl rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_24px_80px_rgba(47,41,35,0.08)]',
    eyebrow: 'mt-6 text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]',
    title: 'mt-2 text-2xl font-semibold text-[var(--text)]',
    message: 'mt-2 text-sm leading-6 text-[var(--muted)]',
    errorBox: 'mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'
  },
  host: {
    outer: 'flex h-full w-full items-center justify-center px-4 py-8',
    card: 'w-full max-w-md rounded-[1.75rem] border border-[var(--border)] bg-[var(--panel)] p-6 shadow-[0_24px_80px_rgba(47,41,35,0.08)]',
    eyebrow: 'text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]',
    title: 'mt-2 text-xl font-semibold text-[var(--text)]',
    message: 'mt-2 text-sm leading-6 text-[var(--muted)]',
    errorBox: 'mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'
  },
  widget: {
    outer: 'flex min-h-screen items-center justify-center px-4 py-6',
    card: 'w-full max-w-md rounded-[2rem] border border-[var(--widget-border)] bg-[var(--widget-panel)] p-5 shadow-[0_24px_70px_rgba(36,33,24,0.14)]',
    eyebrow: 'text-[11px] uppercase tracking-[0.26em] text-[var(--widget-muted)]',
    title: 'mt-2 text-xl font-semibold text-[var(--widget-text)]',
    message: 'mt-2 text-sm leading-6 text-[var(--widget-muted)]',
    errorBox:
      'mt-4 rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700'
  },
  mobile: {
    outer:
      'flex min-h-[100dvh] w-full flex-col bg-[var(--bg)] px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)] text-[var(--text)]',
    card: 'rounded-[2rem] border border-[var(--border)] bg-[var(--panel)] px-5 py-5 shadow-[0_24px_60px_rgba(47,41,35,0.08)]',
    eyebrow: 'text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]',
    title: 'mt-3 text-2xl font-semibold text-stone-900',
    message: 'mt-2 text-sm leading-6 text-[var(--muted)]',
    errorBox:
      'mt-5 rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700'
  }
}

const ErrorBlock = ({
  className,
  error,
  onReload
}: {
  className: string
  error: string
  onReload: () => void
}) => (
  <div className={className}>
    <p className="font-medium">Startup failed</p>
    <p className="mt-1">{error}</p>
    <button
      type="button"
      onClick={onReload}
      className="mt-3 rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700"
    >
      Reload
    </button>
  </div>
)

const IdleIndicator = ({
  variant,
  idleMessage
}: {
  variant: LoadingStatusPanelVariant
  idleMessage: string
}) => {
  if (variant === 'widget') {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-[1.5rem] border border-[var(--widget-border)] bg-white px-4 py-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
        <span className="text-xs text-[var(--widget-muted)]">{idleMessage}</span>
      </div>
    )
  }

  if (variant === 'mobile') {
    return (
      <div className="mt-5 rounded-[1.5rem] border border-stone-200 bg-white px-4 py-4">
        <p className="text-xs text-[var(--muted)]">{idleMessage}</p>
      </div>
    )
  }

  return (
    <div className="mt-5 flex items-center gap-3">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
      <span className="text-xs text-[var(--muted)]">{idleMessage}</span>
    </div>
  )
}

export const LoadingStatusPanel = ({
  variant,
  eyebrow,
  title,
  message,
  error,
  idleMessage,
  onReload = () => window.location.reload()
}: LoadingStatusPanelProps) => {
  const chrome = VARIANT_CHROME[variant]

  return (
    <div className={chrome.outer}>
      <div className={chrome.card}>
        {variant === 'workspace' ? (
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-stone-300" />
            <span className="h-3 w-3 rounded-full bg-stone-300" />
          </div>
        ) : null}
        {variant === 'mobile' ? (
          <div className="flex items-center justify-between">
            <p className={chrome.eyebrow}>{eyebrow}</p>
            <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-[var(--muted)]">
              Mobile
            </span>
          </div>
        ) : (
          <p className={chrome.eyebrow}>{eyebrow}</p>
        )}
        <h1 className={chrome.title}>{title}</h1>
        <p className={chrome.message}>{message}</p>
        {error ? (
          <ErrorBlock className={chrome.errorBox} error={error} onReload={onReload} />
        ) : idleMessage ? (
          <IdleIndicator variant={variant} idleMessage={idleMessage} />
        ) : null}
      </div>
    </div>
  )
}
