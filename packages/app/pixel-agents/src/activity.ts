import type { ChatEvent } from '@tinytinkerer/contracts'
import { PIXEL_AGENT_ID, type PixelServerMessage } from './protocol'

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

export const messagesForChatEvent = (event: ChatEvent): PixelServerMessage[] => {
  switch (event.type) {
    case 'agent.run.started':
      return [
        { type: 'agentToolsClear', id: PIXEL_AGENT_ID },
        { type: 'agentStatus', id: PIXEL_AGENT_ID, status: 'active' }
      ]
    case 'agent.run.completed':
      return [
        { type: 'agentToolsClear', id: PIXEL_AGENT_ID },
        { type: 'agentStatus', id: PIXEL_AGENT_ID, status: 'waiting', awaitingInput: false }
      ]
    case 'agent.step.started':
      return [
        {
          type: 'agentToolStart',
          id: PIXEL_AGENT_ID,
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
          id: PIXEL_AGENT_ID,
          toolId: `step:${event.payload.stepId}`
        }
      ]
    case 'agent.tool.started':
      return [
        {
          type: 'agentToolStart',
          id: PIXEL_AGENT_ID,
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
          id: PIXEL_AGENT_ID,
          toolId: `${event.payload.stepId}:${event.payload.toolId}`
        }
      ]
    default:
      return []
  }
}

export const messagesForUnseenChatEvents = (
  events: readonly ChatEvent[],
  seen: Set<string>
): PixelServerMessage[] => {
  const messages: PixelServerMessage[] = []
  for (const event of events) {
    if (seen.has(event.id)) continue
    seen.add(event.id)
    messages.push(...messagesForChatEvent(event))
  }
  return messages
}
