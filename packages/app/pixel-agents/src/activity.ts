import type { ChatEvent } from '@tinytinkerer/contracts'
import type { PixelServerMessage } from './protocol'
import type { PixelAgentsConversation } from './stage-props'

const READ_TOOL_PATTERN =
  /(?:^|[.:/_-])(read|search|find|list|get|fetch|inspect|query|pick|preview|thumbnail|survey)(?:$|[.:/_-])/i
const SHELL_TOOL_PATTERN = /(?:^|[.:/_-])(bash|shell|terminal|exec|command)(?:$|[.:/_-])/i

export const pixelToolName = (toolId: string): 'Read' | 'Bash' | 'Write' => {
  if (READ_TOOL_PATTERN.test(toolId)) return 'Read'
  if (SHELL_TOOL_PATTERN.test(toolId)) return 'Bash'
  return 'Write'
}

const humanize = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[.:/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const stepToolName = (kind: string): 'Read' | 'Write' =>
  ['plan', 'think', 'observe', 'replan'].includes(kind) ? 'Read' : 'Write'

// Projects one chat event onto the Pixel Agents office, stamped with the id of
// the agent representing ITS conversation (issue #430: one agent per
// conversation, so the caller — not this module — knows which).
export const messagesForChatEvent = (event: ChatEvent, agentId: number): PixelServerMessage[] => {
  switch (event.type) {
    case 'agent.run.started':
      return [
        { type: 'agentToolsClear', id: agentId },
        { type: 'agentStatus', id: agentId, status: 'active' }
      ]
    case 'agent.run.completed':
      return [
        { type: 'agentToolsClear', id: agentId },
        { type: 'agentStatus', id: agentId, status: 'waiting', awaitingInput: false }
      ]
    case 'agent.step.started':
      return [
        {
          type: 'agentToolStart',
          id: agentId,
          toolId: `step:${event.payload.stepId}`,
          status: event.payload.title || humanize(event.payload.kind),
          toolName: stepToolName(event.payload.kind)
        }
      ]
    case 'agent.step.completed':
    case 'agent.step.failed':
      return [
        {
          type: 'agentToolDone',
          id: agentId,
          toolId: `step:${event.payload.stepId}`
        }
      ]
    case 'agent.tool.started':
      return [
        {
          type: 'agentToolStart',
          id: agentId,
          toolId: `${event.payload.stepId}:${event.payload.toolId}`,
          status: humanize(event.payload.toolId) || 'Using a tool',
          toolName: pixelToolName(event.payload.toolId)
        }
      ]
    case 'agent.tool.completed':
    case 'agent.tool.failed':
      return [
        {
          type: 'agentToolDone',
          id: agentId,
          toolId: `${event.payload.stepId}:${event.payload.toolId}`
        }
      ]
    default:
      return []
  }
}

const hasCompletedRun = (events: readonly ChatEvent[]): boolean =>
  events.some((event) => event.type === 'agent.run.completed')

// Whether an idle conversation should read as awaiting input. An UNHYDRATED
// conversation (events not yet loaded — after a reload, every background
// conversation) reads as NOT awaiting: its empty events array says nothing
// about whether a run ever completed (issue #430).
export const isAwaitingInput = (conversation: PixelAgentsConversation): boolean =>
  conversation.eventsLoaded && !hasCompletedRun(conversation.events)

// Tracks step/tool start/stop pairs using the same id scheme as
// `messagesForChatEvent` above, so "is a tool currently open" reflects
// exactly what the office would currently show as an active tool pill.
const hasOpenToolActivity = (events: readonly ChatEvent[]): boolean => {
  const open = new Set<string>()
  for (const event of events) {
    switch (event.type) {
      case 'agent.tool.started':
        open.add(`${event.payload.stepId}:${event.payload.toolId}`)
        break
      case 'agent.tool.completed':
      case 'agent.tool.failed':
        open.delete(`${event.payload.stepId}:${event.payload.toolId}`)
        break
      case 'agent.step.started':
        open.add(`step:${event.payload.stepId}`)
        break
      case 'agent.step.completed':
      case 'agent.step.failed':
        open.delete(`step:${event.payload.stepId}`)
        break
      default:
        break
    }
  }
  return open.size > 0
}

// Scoped to the MOST RECENT run only: scans backward from the end and stops
// at the first `agent.run.started` it finds, so a failure from an earlier,
// already-superseded run never taints the current status.
const mostRecentRunHadFailure = (events: readonly ChatEvent[]): boolean => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    if (event.type === 'agent.run.started') return false
    if (event.type === 'agent.tool.failed' || event.type === 'agent.step.failed') return true
  }
  return false
}

// A textual-surface-friendly status label for one conversation, derived
// entirely from the same ChatEvent stream/`isRunning` flag the graphical
// office projects (no separate docs-only event protocol). There is no
// office-visible distinction between "failed" and "completed" (a failed tool
// clears its pill the same way a completed one does), but the underlying
// ChatEvents make that distinction — 'failed' surfaces it for a fallback
// text UI that has no pixel-art metaphor to fall back on.
export type PixelAgentsActivityStatus =
  | 'running-tool'
  | 'running'
  | 'awaiting-input'
  | 'failed'
  | 'completed'
  | 'idle'

export const conversationActivityStatus = (
  conversation: PixelAgentsConversation
): PixelAgentsActivityStatus => {
  if (conversation.isRunning) {
    return hasOpenToolActivity(conversation.events) ? 'running-tool' : 'running'
  }
  if (!conversation.eventsLoaded) return 'idle'
  if (mostRecentRunHadFailure(conversation.events)) return 'failed'
  return hasCompletedRun(conversation.events) ? 'completed' : 'awaiting-input'
}
