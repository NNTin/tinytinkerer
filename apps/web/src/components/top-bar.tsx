import * as Tooltip from '@radix-ui/react-tooltip'
import { useQuery } from '@tanstack/react-query'
import { StatusPill } from './status-pill'
import { fetchStatus } from '../services/status'

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

  const status = data ?? fallback

  return (
    <Tooltip.Provider delayDuration={120}>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)]/90 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-stone-900">tinytinkerer</h1>
          <p className="text-xs text-[var(--muted)]">A tiny, transparent AI workspace</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill label="Auth" status={status.auth} />
          <StatusPill label="Models" status={status.models} />
          <StatusPill label="Search" status={status.search} />
        </div>
      </header>
    </Tooltip.Provider>
  )
}
