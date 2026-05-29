import { useEffect, useState, type ReactNode } from 'react'
import type { McpServerConfig, ServiceStatus } from '@tinytinkerer/contracts'
import { BrandSettingsFooter } from '@tinytinkerer/brand-assets'
import { MarkdownDocument } from './markdown-document'
import { useSettingsSurfaceController } from './surfaces'
import { PrivacyPolicyDialog } from './telemetry/privacy-policy-dialog'

const GitHubMark = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
)

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

const SectionStatus = ({
  label,
  status
}: {
  label: string
  status: ServiceStatus
}) => (
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

const ToggleRow = ({
  label,
  description,
  checked,
  disabled = false,
  onChange
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) => (
  <label className={`flex items-start justify-between gap-4 py-1 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <span className="min-w-0">
      <span className="block text-sm text-stone-800">{label}</span>
      {description ? <span className="mt-0.5 block text-xs text-[var(--muted)]">{description}</span> : null}
    </span>
    <span className="relative mt-0.5 inline-flex shrink-0 items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="block h-5 w-9 rounded-full border border-stone-300 bg-stone-100 transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300" />
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </span>
  </label>
)

const AuthSection = ({
  status
}: {
  status: ServiceStatus
}) => {
  const { token, clearToken, setToken, canStartGitHubOAuth, startGitHubOAuth, user } =
    useSettingsSurfaceController()
  const [showPat, setShowPat] = useState(false)
  const [patValue, setPatValue] = useState('')

  const handlePatSave = async () => {
    const trimmed = patValue.trim()
    if (!trimmed) {
      return
    }

    await setToken(trimmed)
    setPatValue('')
    setShowPat(false)
  }

  if (token) {
    return (
      <div className="space-y-3">
        <SectionStatus label="Auth" status={status} />
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {user?.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.login}
                className="h-8 w-8 shrink-0 rounded-full border border-stone-200"
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm text-stone-800">{user ? (user.name ?? user.login) : 'Signed in'}</p>
              {user ? (
                <p className="truncate text-xs text-[var(--muted)]">@{user.login}</p>
              ) : (
                <p className="mt-0.5 text-xs text-[var(--muted)]">GitHub token is stored locally in your browser.</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void clearToken()}
            className="inline-flex shrink-0 items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
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
      <p className="text-xs text-[var(--muted)]">Sign in to enable AI responses via GitHub Models.</p>

      {canStartGitHubOAuth ? (
        <button
          type="button"
          onClick={() => startGitHubOAuth()}
          className="inline-flex items-center gap-2 rounded-md border border-stone-800 bg-stone-900 px-4 py-2 text-sm text-white transition-colors hover:bg-stone-700"
        >
          <GitHubMark />
          Sign in with GitHub
        </button>
      ) : null}

      {showPat ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">
            Paste a GitHub PAT with <code className="rounded bg-stone-100 px-1 font-mono">models:read</code> scope.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={patValue}
              onChange={(event) => setPatValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void handlePatSave()
                }
              }}
              placeholder="ghp_…"
              autoFocus
              className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-700 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
            />
            <button
              type="button"
              onClick={() => void handlePatSave()}
              className="inline-flex items-center rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 text-xs text-white transition-colors hover:bg-stone-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPat(false)
                setPatValue('')
              }}
              className="inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition-colors hover:bg-stone-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowPat(true)}
          className="inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
        >
          Use a personal access token instead
        </button>
      )}
    </div>
  )
}

const ModelsSection = ({
  status
}: {
  status: ServiceStatus
}) => {
  const { selectedModel, setSelectedModel, models } = useSettingsSurfaceController()

  return (
    <div className="space-y-2">
      <SectionStatus label="Models" status={status} />
      <label htmlFor="model-select" className="block text-sm text-stone-800">
        Model
      </label>
      <select
        id="model-select"
        value={selectedModel}
        onChange={(event) => void setSelectedModel(event.target.value)}
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-300"
      >
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-[var(--muted)]">Requires a GitHub token with Models access.</p>
    </div>
  )
}

const SearchSection = ({
  status
}: {
  status: ServiceStatus
}) => {
  const { searchEnabled, setSearchEnabled, searchUnavailable } = useSettingsSurfaceController()

  return (
    <div className="space-y-3">
      <SectionStatus label="Search" status={status} />
      <ToggleRow
        label="Enable web search"
        description={
          searchUnavailable
            ? 'Web search is unavailable right now. The runtime will skip search until the service recovers.'
            : 'Allow the agent to search the web for up-to-date information.'
        }
        checked={searchEnabled}
        disabled={searchUnavailable}
        onChange={(next) => void setSearchEnabled(next)}
      />
    </div>
  )
}

type McpServerFormState = {
  name: string
  url: string
  bearerToken: string
}

const emptyForm = (): McpServerFormState => ({ name: '', url: '', bearerToken: '' })

const McpServerCard = ({
  server,
  discovery,
  isSyncing,
  onToggle,
  onRefresh,
  onRemove,
  onSave
}: {
  server: McpServerConfig
  discovery: ReturnType<typeof useSettingsSurfaceController>['mcpDiscovery'][string] | undefined
  isSyncing: boolean
  onToggle: (enabled: boolean) => void
  onRefresh: () => void
  onRemove: () => void
  onSave: (patch: Partial<Omit<McpServerConfig, 'id'>>, triggerRefresh: boolean) => void
}) => {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<McpServerFormState>({
    name: server.name,
    url: server.url,
    bearerToken: server.bearerToken ?? ''
  })

  const syncBadge = isSyncing
    ? 'Syncing…'
    : discovery?.error
      ? discovery.error
      : discovery
        ? `${discovery.tools.length} tool${discovery.tools.length !== 1 ? 's' : ''}`
        : 'Not synced'

  const badgeClass = isSyncing
    ? 'text-amber-700'
    : discovery?.error
      ? 'text-rose-600'
      : discovery
        ? 'text-emerald-700'
        : 'text-stone-400'

  const handleSave = () => {
    const patch: Partial<Omit<McpServerConfig, 'id'>> = {}
    if (form.name !== server.name) patch.name = form.name
    if (form.url !== server.url) patch.url = form.url
    const token = form.bearerToken.trim() || undefined
    if (token !== server.bearerToken) patch.bearerToken = token
    const connectionChanged = 'url' in patch || 'bearerToken' in patch
    if (Object.keys(patch).length > 0) onSave(patch, connectionChanged)
    setEditing(false)
  }

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-stone-800">{server.name}</p>
          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{server.url}</p>
          <p className={`mt-0.5 text-xs ${badgeClass}`}>{syncBadge}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="h-3.5 w-3.5 accent-amber-500"
            title={server.enabled ? 'Disable' : 'Enable'}
          />
          <button
            type="button"
            onClick={onRefresh}
            disabled={isSyncing}
            className="rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 disabled:opacity-50"
          >
            ↺
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100"
          >
            {editing ? 'Close' : 'Edit'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-1.5 py-0.5 text-xs text-rose-500 hover:bg-rose-50"
          >
            ✕
          </button>
        </div>
      </div>
      {editing ? (
        <div className="mt-2 space-y-1.5 border-t border-stone-100 pt-2">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
            className="w-full rounded border border-stone-300 px-2 py-1 text-xs outline-none focus:border-amber-400"
          />
          <input
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="URL"
            className="w-full rounded border border-stone-300 px-2 py-1 text-xs outline-none focus:border-amber-400"
          />
          <input
            type="password"
            value={form.bearerToken}
            onChange={(e) => setForm((f) => ({ ...f, bearerToken: e.target.value }))}
            placeholder="Bearer token (optional)"
            className="w-full rounded border border-stone-300 px-2 py-1 text-xs outline-none focus:border-amber-400"
          />
          <button
            type="button"
            onClick={handleSave}
            className="rounded bg-stone-900 px-2.5 py-1 text-xs text-white hover:bg-stone-700"
          >
            Save
          </button>
        </div>
      ) : null}
    </div>
  )
}

export const McpServerList = () => {
  const {
    mcpServers,
    mcpDiscovery,
    addMcpServer,
    updateMcpServer,
    removeMcpServer,
    setMcpServerEnabled,
    refreshMcpServer
  } = useSettingsSurfaceController()

  const [addForm, setAddForm] = useState<McpServerFormState | null>(null)
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set())

  const doRefresh = async (server: McpServerConfig) => {
    setSyncingIds((s) => new Set(s).add(server.id))
    try {
      await refreshMcpServer(server)
    } finally {
      setSyncingIds((s) => {
        const next = new Set(s)
        next.delete(server.id)
        return next
      })
    }
  }

  const handleAdd = async () => {
    if (!addForm?.name.trim() || !addForm.url.trim()) return
    const newServer = await addMcpServer({
      name: addForm.name.trim(),
      url: addForm.url.trim(),
      bearerToken: addForm.bearerToken.trim() || undefined,
      enabled: true
    })
    setAddForm(null)
    void doRefresh(newServer)
  }

  return (
    <div className="space-y-2">
      {mcpServers.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">No MCP servers added yet.</p>
      ) : (
        mcpServers.map((server) => (
          <McpServerCard
            key={server.id}
            server={server}
            discovery={mcpDiscovery[server.id]}
            isSyncing={syncingIds.has(server.id)}
            onToggle={(enabled) => void setMcpServerEnabled(server.id, enabled)}
            onRefresh={() => void doRefresh(server)}
            onRemove={() => void removeMcpServer(server.id)}
            onSave={(patch, triggerRefresh) => {
              void updateMcpServer(server.id, patch).then(() => {
                if (triggerRefresh) void doRefresh({ ...server, ...patch })
              })
            }}
          />
        ))
      )}
      {addForm !== null ? (
        <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <input
            value={addForm.name}
            onChange={(e) => setAddForm((f) => f && { ...f, name: e.target.value })}
            placeholder="Name"
            autoFocus
            className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-400"
          />
          <input
            value={addForm.url}
            onChange={(e) => setAddForm((f) => f && { ...f, url: e.target.value })}
            placeholder="https://mcp.example.com/mcp"
            className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-400"
          />
          <input
            type="password"
            value={addForm.bearerToken}
            onChange={(e) => setAddForm((f) => f && { ...f, bearerToken: e.target.value })}
            placeholder="Bearer token (optional)"
            className="w-full rounded border border-stone-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-400"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleAdd()}
              className="rounded bg-stone-900 px-2.5 py-1 text-xs text-white hover:bg-stone-700"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddForm(null)}
              className="rounded border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddForm(emptyForm())}
          className="inline-flex items-center rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
        >
          + Add server
        </button>
      )}
    </div>
  )
}

const InterfaceSection = () => {
  const {
    showThinkingTimeline,
    setShowThinkingTimeline,
    showToolActivity,
    setShowToolActivity,
    showCodeBlockFullscreenButton,
    setShowCodeBlockFullscreenButton
  } = useSettingsSurfaceController()

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
      <ToggleRow
        label="Code block fullscreen button"
        description="Show a fullscreen toggle on code blocks."
        checked={showCodeBlockFullscreenButton}
        onChange={(next) => void setShowCodeBlockFullscreenButton(next)}
      />
    </div>
  )
}

const PrivacySection = () => {
  const { telemetryEnabled, setTelemetryEnabled } = useSettingsSurfaceController()
  const [policyOpen, setPolicyOpen] = useState(false)

  return (
    <div className="space-y-3">
      <ToggleRow
        label="Enable telemetry"
        description="Send pseudonymous crash reports to help fix bugs."
        checked={telemetryEnabled}
        onChange={(next) => void setTelemetryEnabled(next)}
      />
      <p className="text-xs text-[var(--muted)]">
        This application uses optional telemetry to improve reliability and performance.{' '}
        <button
          type="button"
          onClick={() => setPolicyOpen(true)}
          className="font-medium text-amber-700 underline-offset-2 hover:underline"
        >
          See Privacy Policy
        </button>{' '}
        for details.
      </p>
      <PrivacyPolicyDialog open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </div>
  )
}

export const BrowserSettingsModal = ({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) => {
  const { effectiveStatus, refreshStatus } = useSettingsSurfaceController()

  useEffect(() => {
    if (open) {
      void refreshStatus()
    }
  }, [open, refreshStatus])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close settings"
        className="settings-overlay absolute inset-0 bg-stone-900/30 backdrop-blur-sm"
        data-state="open"
        onClick={() => onOpenChange(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="settings-content fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-xl outline-none"
        data-state="open"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-base font-semibold text-stone-900">Settings</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => onOpenChange(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
          <SettingsSection title="Auth">
            <AuthSection status={effectiveStatus.auth} />
          </SettingsSection>

          <hr className="border-[var(--border)]" />

          <SettingsSection title="Models">
            <ModelsSection status={effectiveStatus.models} />
          </SettingsSection>

          <hr className="border-[var(--border)]" />

          <SettingsSection title="Search">
            <SearchSection status={effectiveStatus.search} />
          </SettingsSection>

          <hr className="border-[var(--border)]" />

          <SettingsSection title="Interface">
            <InterfaceSection />
          </SettingsSection>

          <hr className="border-[var(--border)]" />

          <SettingsSection title="MCP Servers">
            <McpServerList />
          </SettingsSection>

          <hr className="border-[var(--border)]" />

          <SettingsSection title="Privacy">
            <PrivacySection />
          </SettingsSection>

          <hr className="border-[var(--border)]" />

          <BrandSettingsFooter renderMarkdown={(markdown) => <MarkdownDocument markdown={markdown} />} />
        </div>
      </div>
    </div>
  )
}
