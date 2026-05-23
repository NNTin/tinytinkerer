import * as Tooltip from '@radix-ui/react-tooltip'
import type { ServiceStatus } from '@tinytinkerer/app-browser'

type StatusPillProps = {
  label: string
  status: ServiceStatus
}

const dotClass: Record<ServiceStatus['state'], string> = {
  ready: 'bg-emerald-500',
  degraded: 'bg-amber-500 status-dot-pulse',
  offline: 'bg-rose-500 status-dot-pulse'
}

export const StatusPill = ({ label, status }: StatusPillProps) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button
        type="button"
        className="inline-flex cursor-default items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 text-xs text-stone-700 transition-colors hover:bg-stone-50"
      >
        <span className={`h-2 w-2 rounded-full ${dotClass[status.state]}`} />
        {label}
      </button>
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        sideOffset={6}
        className="max-w-64 rounded-md border border-stone-300 bg-stone-900 px-3 py-2 text-xs text-stone-100"
      >
        <p>{status.detail}</p>
        {status.error ? <p className="mt-1 text-rose-300">{status.error}</p> : null}
        <Tooltip.Arrow className="fill-stone-900" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
)
