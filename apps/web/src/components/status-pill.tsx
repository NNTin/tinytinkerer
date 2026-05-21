import * as Tooltip from '@radix-ui/react-tooltip'
import type { ServiceStatus } from '@tinytinkerer/types'

type StatusPillProps = {
  label: string
  status: ServiceStatus
}

const colorMap: Record<ServiceStatus['state'], string> = {
  ready: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  offline: 'bg-rose-500'
}

export const StatusPill = ({ label, status }: StatusPillProps) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/70 px-3 py-1 text-xs text-stone-700"
      >
        <span className={`h-2 w-2 rounded-full ${colorMap[status.state]}`} />
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
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
)
