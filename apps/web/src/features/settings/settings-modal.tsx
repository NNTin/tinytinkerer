import * as Dialog from '@radix-ui/react-dialog'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { ServiceStatus, SystemStatus } from '@tinytinkerer/app-browser'
import { useAuthStore } from '../../stores/auth-store.js'
import { useSettingsStore } from '../../stores/settings-store.js'
import { buildGitHubLoginUrl } from '../../services/auth.js'
import { fetchStatus } from '../../services/status.js'
import { SUPPORTED_MODELS } from '../../services/models.js'

const fallbackStatus: SystemStatus = {
  auth: { state: 'offline', detail: 'Unavailable' },
  models: { state: 'offline', detail: 'Unavailable' },
  search: { state: 'offline', detail: 'Unavailable' }
}

// ── Shared primitives ─────────────────────────────────────────────────────────

const SectionHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{children}</h3>
)

const statusClasses: Record<ServiceStatus['state'], string> = {
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  degraded: 'border-amber-200 bg-amber-50 text-amber-800',
  offline: 'border-rose-200 bg-rose-50 text-rose-700'
}

const statusDotClasses: Record<ServiceStatus['state'], string> = {
  ready: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  offline: 'bg-rose-500'
}

const SectionStatus = ({ label, status }: { label: string; status: ServiceStatus }) => (
  <div className={`rounded-lg border px-3 py-2 text-xs ${statusClasses[status.state]}`}>
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${statusDotClasses[status.state]}`} aria-hidden="true" />
      <span className="font-medium">{label} status</span>
      <span className="capitalize">{status.state}</span>
    </div>
    <p className="mt-1">{status.detail}</p>
    {status.error ? <p className="mt-1">{status.error}</p> : null}
  </div>
)

const SettingsSection = ({
  title,
  children
}: {
  title: string
  children: ReactNode
}) => (
  <section role="region" aria-label={title}>
    <SectionHeading>{title}</SectionHeading>
    <div className="mt-3">{children}</div>
  </section>
)

type ToggleRowProps = {
  label: string
  description?: string
  checked: boolean
  onChange: (next: boolean) => void
}

const ToggleRow = ({ label, description, checked, onChange }: ToggleRowProps) => (
  <label className="flex cursor-pointer items-start justify-between gap-4 py-1">
    <span className="min-w-0">
      <span className="block text-sm text-stone-800">{label}</span>
      {description ? <span className="block text-xs text-[var(--muted)] mt-0.5">{description}</span> : null}
    </span>
    <span className="relative mt-0.5 inline-flex shrink-0 items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="block h-5 w-9 rounded-full border border-stone-300 bg-stone-100 transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300" />
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </span>
  </label>
)

// ── GitHub mark SVG ───────────────────────────────────────────────────────────

const GitHubMark = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

// ── Auth section ──────────────────────────────────────────────────────────────

const AuthSection = ({ status }: { status: ServiceStatus }) => {
  const token = useAuthStore((state) => state.token)
  const clearToken = useAuthStore((state) => state.clearToken)
  const setToken = useAuthStore((state) => state.setToken)
  const loginUrl = buildGitHubLoginUrl()

  const [showPat, setShowPat] = useState(false)
  const [patValue, setPatValue] = useState('')

  const handlePatSave = async () => {
    const trimmed = patValue.trim()
    if (!trimmed) return
    await setToken(trimmed)
    setPatValue('')
    setShowPat(false)
  }

  if (token) {
    return (
      <div className="space-y-3">
        <SectionStatus label="Auth" status={status} />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-stone-800">Signed in</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">GitHub token is stored locally in your browser.</p>
          </div>
          <button
            type="button"
            onClick={() => void clearToken()}
            className="inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <SectionStatus label="Auth" status={status} />
      <p className="text-xs text-[var(--muted)]">
        Sign in to enable AI responses via GitHub Models.
      </p>

      {loginUrl && (
        <a
          href={loginUrl}
          className="inline-flex items-center gap-2 rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white hover:bg-stone-700 transition-colors"
        >
          <GitHubMark />
          Sign in with GitHub
        </a>
      )}

      {showPat ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">
            Paste a GitHub PAT with <code className="rounded bg-stone-100 px-1 font-mono">models:read</code> scope.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={patValue}
              onChange={(e) => setPatValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handlePatSave() }}
              placeholder="ghp_…"
              autoFocus
              className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
            />
            <button
              type="button"
              onClick={() => void handlePatSave()}
              className="inline-flex items-center rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 text-xs text-white hover:bg-stone-700 transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setShowPat(false); setPatValue('') }}
              className="inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowPat(true)}
          className="inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-300 hover:bg-stone-50 transition-colors"
        >
          Use a personal access token instead
        </button>
      )}
    </div>
  )
}

// ── Models section ────────────────────────────────────────────────────────────

const ModelsSection = ({ status }: { status: ServiceStatus }) => {
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)

  return (
    <div className="space-y-2">
      <SectionStatus label="Models" status={status} />
      <label htmlFor="model-select" className="block text-sm text-stone-800">
        Model
      </label>
      <select
        id="model-select"
        value={selectedModel}
        onChange={(e) => void setSelectedModel(e.target.value)}
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
      >
        {SUPPORTED_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <p className="text-xs text-[var(--muted)]">Requires a GitHub token with Models access.</p>
    </div>
  )
}

// ── Search section ────────────────────────────────────────────────────────────

const SearchSection = ({ status }: { status: ServiceStatus }) => {
  const searchEnabled = useSettingsStore((state) => state.searchEnabled)
  const setSearchEnabled = useSettingsStore((state) => state.setSearchEnabled)

  return (
    <div className="space-y-3">
      <SectionStatus label="Search" status={status} />
      <ToggleRow
        label="Enable web search"
        description="Allow the agent to search the web for up-to-date information."
        checked={searchEnabled}
        onChange={(next) => void setSearchEnabled(next)}
      />
    </div>
  )
}

// ── Interface section ─────────────────────────────────────────────────────────

const InterfaceSection = () => {
  const showThinkingTimeline = useSettingsStore((state) => state.showThinkingTimeline)
  const setShowThinkingTimeline = useSettingsStore((state) => state.setShowThinkingTimeline)
  const showToolActivity = useSettingsStore((state) => state.showToolActivity)
  const setShowToolActivity = useSettingsStore((state) => state.setShowToolActivity)

  return (
    <div className="space-y-3">
      <ToggleRow
        label="Thinking timeline"
        description="Show step-by-step planning activity during a run."
        checked={showThinkingTimeline}
        onChange={(next) => void setShowThinkingTimeline(next)}
      />
      <ToggleRow
        label="Tool activity"
        description="Show web search results and tool outputs."
        checked={showToolActivity}
        onChange={(next) => void setShowToolActivity(next)}
      />
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type SettingsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const SettingsModal = ({ open, onOpenChange }: SettingsModalProps) => (
  <SettingsModalContent open={open} onOpenChange={onOpenChange} />
)

const SettingsModalContent = ({ open, onOpenChange }: SettingsModalProps) => {
  const { data } = useQuery({
    queryKey: ['system-status'],
    queryFn: fetchStatus,
    enabled: open,
    refetchInterval: 15_000
  })

  const status = data ?? fallbackStatus

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay fixed inset-0 z-40 bg-stone-900/30 backdrop-blur-sm" />
        <Dialog.Content
          className="settings-content fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
            <Dialog.Title className="text-base font-semibold text-stone-900">Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close settings"
                className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
            <SettingsSection title="Auth">
              <AuthSection status={status.auth} />
            </SettingsSection>

            <hr className="border-[var(--border)]" />

            <SettingsSection title="Models">
              <ModelsSection status={status.models} />
            </SettingsSection>

            <hr className="border-[var(--border)]" />

            <SettingsSection title="Search">
              <SearchSection status={status.search} />
            </SettingsSection>

            <hr className="border-[var(--border)]" />

            <SettingsSection title="Interface">
              <InterfaceSection />
            </SettingsSection>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
