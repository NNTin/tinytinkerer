import * as Dialog from '@radix-ui/react-dialog'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useState } from 'react'
import { useAuthStore } from '../../stores/auth-store.js'
import { useSettingsStore } from '../../stores/settings-store.js'
import { buildGitHubLoginUrl } from '../../services/auth.js'

const SUPPORTED_MODELS = [
  { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini' }
]

// ── Shared primitives ─────────────────────────────────────────────────────────

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{children}</h3>
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

const AuthSection = () => {
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-stone-800">Signed in</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">GitHub token is stored locally in your browser.</p>
        </div>
        <button
          type="button"
          onClick={() => void clearToken()}
          className="inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 hover:border-stone-300 hover:bg-stone-50 transition-colors"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
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

const ModelsSection = () => {
  const selectedModel = useSettingsStore((state) => state.selectedModel)
  const setSelectedModel = useSettingsStore((state) => state.setSelectedModel)

  return (
    <div className="space-y-2">
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

const SearchSection = () => {
  const searchEnabled = useSettingsStore((state) => state.searchEnabled)
  const setSearchEnabled = useSettingsStore((state) => state.setSearchEnabled)

  return (
    <ToggleRow
      label="Enable web search"
      description="Allow the agent to search the web for up-to-date information."
      checked={searchEnabled}
      onChange={(next) => void setSearchEnabled(next)}
    />
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
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="settings-overlay fixed inset-0 z-40 bg-stone-900/30 backdrop-blur-sm" />
      <Dialog.Content
        className="settings-content fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
        aria-describedby={undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <Dialog.Title className="text-base font-semibold text-stone-900">Settings</Dialog.Title>
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="Close settings"
              className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </Dialog.Close>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-6">
          {/* Auth */}
          <section>
            <SectionHeading>Auth</SectionHeading>
            <div className="mt-3">
              <AuthSection />
            </div>
          </section>

          <hr className="border-[var(--border)]" />

          {/* Models */}
          <section>
            <SectionHeading>Models</SectionHeading>
            <div className="mt-3">
              <ModelsSection />
            </div>
          </section>

          <hr className="border-[var(--border)]" />

          {/* Search */}
          <section>
            <SectionHeading>Search</SectionHeading>
            <div className="mt-3">
              <SearchSection />
            </div>
          </section>

          <hr className="border-[var(--border)]" />

          {/* Interface */}
          <section>
            <SectionHeading>Interface</SectionHeading>
            <div className="mt-3">
              <InterfaceSection />
            </div>
          </section>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
)
