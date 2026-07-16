import type { ChatEvent } from '@tinytinkerer/contracts'
import type { PixelServerMessage } from './protocol'

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
