import * as Tooltip from '@radix-ui/react-tooltip'
import { useQuery } from '@tanstack/react-query'
import { StatusPill } from './status-pill'
import { fetchStatus } from '../services/status'
import { buildGitHubLoginUrl } from '../services/auth'
import { useAuthStore } from '../stores/auth-store'

const fallback = {
  auth: { state: 'offline', detail: 'Unavailable' },
  models: { state: 'offline', detail: 'Unavailable' },
  search: { state: 'offline', detail: 'Unavailable' }
} as const

export const TopBar = () => {
  const { data } = useQuery({
    queryKey: ['system-status'],
    queryFn: fetchStatus,
    refetchInterval: 15_000
  })

  const token = useAuthStore((state) => state.token)
  const clearToken = useAuthStore((state) => state.clearToken)
  const loginUrl = buildGitHubLoginUrl()
  const status = data ?? fallback

  return (
    <Tooltip.Provider delayDuration={120}>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)]/90 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-stone-900">tinytinkerer</h1>
          <p className="text-xs text-[var(--muted)]">A tiny, transparent AI workspace</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label="Auth" status={status.auth} />
          <StatusPill label="Models" status={status.models} />
          <StatusPill label="Search" status={status.search} />
          {token ? (
            <button
              type="button"
              onClick={() => void clearToken()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 text-xs text-stone-700 hover:bg-stone-100"
            >
              Sign out
            </button>
          ) : loginUrl ? (
            <a
              href={loginUrl}
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-800 bg-stone-900 px-3 py-1 text-xs text-white hover:bg-stone-700"
            >
              Sign in with GitHub
            </a>
          ) : null}
        </div>
      </header>
    </Tooltip.Provider>
  )
}
