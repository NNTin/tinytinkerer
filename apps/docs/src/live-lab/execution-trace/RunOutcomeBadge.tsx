import type { PixelAgentsActivityStatus } from '@tinytinkerer/pixel-agents'
import type { RunOutcome } from './trace'

type BadgeTone = 'success' | 'neutral' | 'warning' | 'error'

type BadgeMeta = { icon: string; label: string; tone: BadgeTone }

// A settled run's terminal badge (issue #454 acceptance: "successful,
// cancelled, rate-limited, permission-denied, and tool-failure runs end in
// distinct, understandable states"). Every state pairs a glyph with a
// spelled-out word — never colour alone — mirroring the codebase's existing
// non-colour-cue convention (see turn-activity-panel.tsx's statusStyles /
// decisionStyles).
const RUN_OUTCOME_META: Record<RunOutcome, BadgeMeta> = {
  succeeded: { icon: '✓', label: 'Succeeded', tone: 'success' },
  cancelled: { icon: '■', label: 'Cancelled', tone: 'neutral' },
  'rate-limited': { icon: '⏳', label: 'Rate limited', tone: 'warning' },
  'permission-denied': { icon: '⊘', label: 'Permission denied', tone: 'warning' },
  'tool-failure': { icon: '✕', label: 'Tool failure', tone: 'error' },
  error: { icon: '✕', label: 'Error', tone: 'error' }
}

// The LIVE run's badge instead mirrors @tinytinkerer/pixel-agents's own
// `conversationActivityStatus` (see ExecutionTracePanel), so what the trace
// shows while a run is in flight is always the SAME state the Pixel Agents
// office itself shows for that conversation.
const LIVE_STATUS_META: Record<PixelAgentsActivityStatus, BadgeMeta> = {
  'running-tool': { icon: '▶', label: 'Using a tool…', tone: 'neutral' },
  running: { icon: '▶', label: 'Running…', tone: 'neutral' },
  'awaiting-input': { icon: '…', label: 'Awaiting input', tone: 'neutral' },
  failed: { icon: '✕', label: 'Failed', tone: 'error' },
  completed: { icon: '✓', label: 'Completed', tone: 'success' },
  idle: { icon: '…', label: 'Idle', tone: 'neutral' }
}

const Badge = ({ icon, label, tone }: BadgeMeta): React.JSX.Element => (
  <span className={`execution-trace-lab__badge execution-trace-lab__badge--${tone}`}>
    <span aria-hidden="true">{icon}</span>
    {label}
  </span>
)

export const RunOutcomeBadge = ({ outcome }: { outcome: RunOutcome }): React.JSX.Element => (
  <Badge {...RUN_OUTCOME_META[outcome]} />
)

export const LiveStatusBadge = ({
  status
}: {
  status: PixelAgentsActivityStatus
}): React.JSX.Element => <Badge {...LIVE_STATUS_META[status]} />
