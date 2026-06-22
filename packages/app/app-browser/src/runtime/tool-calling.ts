import type { ChatMessage, ChatToolDefinition, ChatToolCall } from '@tinytinkerer/contracts'
import type { ToolInvocation } from '@tinytinkerer/app-core'
import type { PlannerToolDescriptor } from './mcp-planner'

// Native OpenAI tool calling (issue #276). The runtime's tool ids — e.g.
// `mcp:<serverId>:<toolName>` — contain characters (`:`) that OpenAI rejects in a
// function name (`^[a-zA-Z0-9_-]+$`). We therefore advertise a *sanitized* wire
// name to the model and keep an explicit per-request name⇄toolId map so the
// model's chosen function name resolves back to the real tool id. The reverse
// direction goes through the map (NOT a lossy regex round-trip), because the
// forward sanitize is many-to-one.

// Forward direction: a tool id → a wire-safe function name. Lossy by design;
// disambiguation against collisions is handled by buildToolNameMap.
export const sanitizeToolName = (toolId: string): string => toolId.replace(/[^a-zA-Z0-9_-]/g, '_')

// A per-request mapping between runtime tool ids and the wire function names
// advertised to the model, plus the advertised tool definitions. `toToolId`
// resolves a name the model returned; it falls back to the raw name so an
// unknown/echoed name still produces a (best-effort) tool id rather than
// throwing — the runtime's tool registry is the real gate.
export type ToolNameMap = {
  toWire: (toolId: string) => string
  toToolId: (wireName: string) => string
  definitions: ChatToolDefinition[]
}

export const buildToolNameMap = (tools: PlannerToolDescriptor[]): ToolNameMap => {
  const toWireMap = new Map<string, string>()
  const toToolIdMap = new Map<string, string>()
  const usedWireNames = new Set<string>()

  for (const tool of tools) {
    let wire = sanitizeToolName(tool.id)
    // Disambiguate sanitize collisions (two ids that sanitize to the same name)
    // so the reverse map stays 1:1 and the model can address each tool uniquely.
    if (usedWireNames.has(wire)) {
      let suffix = 2
      while (usedWireNames.has(`${wire}_${suffix}`)) {
        suffix += 1
      }
      wire = `${wire}_${suffix}`
    }
    usedWireNames.add(wire)
    toWireMap.set(tool.id, wire)
    toToolIdMap.set(wire, tool.id)
  }

  const definitions: ChatToolDefinition[] = tools.map((tool) => ({
    type: 'function',
    function: {
      name: toWireMap.get(tool.id) ?? sanitizeToolName(tool.id),
      description: tool.description,
      parameters: tool.inputSchema
    }
  }))

  return {
    toWire: (toolId) => toWireMap.get(toolId) ?? sanitizeToolName(toolId),
    toToolId: (wireName) => toToolIdMap.get(wireName) ?? wireName,
    definitions
  }
}

// Parse the arguments of a native tool call into the action input. OpenAI sends
// `function.arguments` as a JSON-encoded STRING (not a parsed object), so this is
// strict tool-call wire parsing — not the brittle prose-wrapped decision JSON the
// `*-decider`/`*-planner` lint rule targets — hence it lives here, beside the rest
// of the tool-call plumbing. A missing or unparseable value yields empty input;
// the tool's own schema validation is the real gate (issue #276).
export const parseToolCallArguments = (argumentsJson: string): Record<string, unknown> => {
  if (!argumentsJson || argumentsJson.trim().length === 0) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

// Serialize a tool invocation's result/error into the `tool` message content.
// Tool output is arbitrary; JSON-encode it (falling back to String for
// non-serializable values) so the model receives structured, parseable results.
// Per-message clamping to the edge ceiling happens centrally in
// modelsChatRequestBody, so this does not truncate here.
const serializeToolResult = (outcome: ToolInvocation['outcome']): string => {
  if (!outcome.ok) {
    return `Error: ${outcome.error}`
  }
  try {
    return JSON.stringify(outcome.output) ?? String(outcome.output)
  } catch {
    return String(outcome.output)
  }
}

// Turn the run's ordered tool invocations into native OpenAI message turns
// (issue #276): each call becomes an `assistant` message carrying a single
// `tool_calls` entry, followed by its `tool` result message keyed by the same
// `tool_call_id`. This replaces the prior "Research notes:/Tool results:" prose
// glued onto a user turn, and is shared by BOTH the decide and synthesize paths
// so their message shape is identical.
export const toolInvocationsToMessages = (
  invocations: readonly ToolInvocation[],
  toWire: (toolId: string) => string
): ChatMessage[] => {
  const messages: ChatMessage[] = []
  for (const invocation of invocations) {
    const toolCall: ChatToolCall = {
      id: invocation.callId,
      type: 'function',
      function: {
        name: toWire(invocation.toolId),
        arguments: JSON.stringify(invocation.input)
      }
    }
    messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] })
    messages.push({
      role: 'tool',
      tool_call_id: invocation.callId,
      content: serializeToolResult(invocation.outcome)
    })
  }
  return messages
}
