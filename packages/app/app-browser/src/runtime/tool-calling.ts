import type { ChatMessage, ChatToolDefinition, ChatToolCall } from '@tinytinkerer/contracts'
import { mediaRefFor, partitionToolResultMedia } from '@tinytinkerer/contracts'
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

// Normalize a tool descriptor's `inputSchema` into the JSON Schema OpenAI expects
// for `function.parameters` (issue #276). Since issue #287 every planner descriptor
// already arrives as a real JSON Schema object — plugin descriptors are GENERATED
// from their Zod schema (toolInputJsonSchema, has `type: 'object'`/`properties`)
// and MCP tools supply their discovered JSON Schema — so this normally passes the
// schema through untouched. The legacy wrap of a bare PROPERTIES MAP shorthand
// (`{ code: { type, … }, … }`) is kept only as a defensive fallback: without the
// `{ type: 'object', properties }` envelope the model isn't told the call HAS named
// parameters and fires the tool with empty `{}` arguments.
const toWireParameters = (inputSchema: Record<string, unknown>): Record<string, unknown> => {
  if ('type' in inputSchema || 'properties' in inputSchema) {
    return inputSchema
  }
  return { type: 'object', properties: inputSchema }
}

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
      parameters: toWireParameters(tool.inputSchema)
    }
  }))

  return {
    toWire: (toolId) => toWireMap.get(toolId) ?? sanitizeToolName(toolId),
    toToolId: (wireName) => toToolIdMap.get(wireName) ?? wireName,
    definitions
  }
}

// Legacy planner wire decoder, retained as a compatibility re-export. It falls
// back to {} for malformed input. ReAct uses the strict native-call gate below
// so an incomplete call can never become runnable empty input.
export { parseToolCallArguments } from '@tinytinkerer/contracts'

// Native function.arguments is protocol JSON, not free-form model prose. Do
// not use the prose-recovery parser: it could extract a complete nested object
// from a truncated outer argument bag, and captures raw input in telemetry.
// Never turn malformed or truncated arguments into empty input: even a tool
// with an all-optional schema could otherwise execute an unintended mutation.
export const parseCompleteToolCallArguments = (value: string): Record<string, unknown> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('ReAct tool call arguments are not complete valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ReAct tool call arguments must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

// Serialize a tool invocation's result/error into the `tool` message content.
// Tool output is arbitrary; JSON-encode it (falling back to String for
// non-serializable values) so the model receives structured, parseable results.
// Per-message clamping to the edge ceiling happens centrally in
// modelsChatRequestBody, so this does not truncate here.
//
// Image-bearing output gets one extra step first: `partitionToolResultMedia`
// strips each media item's base64 `dataUrl` out of the payload, and the model
// gets a compact `{ mediaRef, description, width, height, mimeType }` handle in
// its place — a short ref plus a text description rather than the base64 blob.
// This is the seam that was bloating every DECIDE/SYNTHESIZE request with
// inline image data; the UI resolves the same `mediaRef` back to the actual
// image via its own media registry, keyed off the same partitioned array (the
// enumeration index below MUST line up with that array, not the raw output).
const serializeToolResult = (outcome: ToolInvocation['outcome'], callId: string): string => {
  if (!outcome.ok) {
    return `Error: ${outcome.error}`
  }
  try {
    const { rest, media } = partitionToolResultMedia(outcome.output)
    if (media.length === 0) {
      return JSON.stringify(outcome.output) ?? String(outcome.output)
    }
    const modelOutput = {
      ...(rest as Record<string, unknown>),
      media: media.map((item, index) => ({
        mediaRef: mediaRefFor(callId, index),
        description: item.description,
        width: item.width,
        height: item.height,
        mimeType: item.mimeType
      }))
    }
    return JSON.stringify(modelOutput) ?? String(outcome.output)
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
      content: serializeToolResult(invocation.outcome, invocation.callId)
    })
  }
  return messages
}
