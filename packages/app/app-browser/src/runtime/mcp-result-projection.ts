import type { ToolInvocation } from '@tinytinkerer/app-core'
import type { McpCallResponse } from '@tinytinkerer/contracts'

// Model-facing projection of a tool result (issue #532).
//
// The edge's `/api/mcp/call` envelope carries the server's CallToolResult
// verbatim in `raw`, plus a top-level `text` that is only an ALIAS of it: the
// `type: 'text'` blocks of `raw.content`, in order, joined with '\n' (see
// `buildMcpCallResponse` in contracts, the producer). Serializing the whole
// envelope into the `tool` message therefore sends every text payload twice —
// a large KiPrint guide or footprint once in `text` and again, escaped the same
// way, in `raw.content[].text` — on every later decision and in synthesis.
//
// This drops exactly that alias, and only where the alias is established:
//
// - Provenance comes from the invocation, not from the output's shape. The
//   tool must be host-registered as MCP (`source.kind === 'mcp'`, stamped by
//   create-runtime from the registry, never by the tool) and its id must be the
//   `mcp:<server id>:<tool>` that server's envelope names. A plugin or app tool
//   whose output merely looks like an envelope, or has a `text` key, is sent
//   unchanged; so is an invocation with no `source` (a host that stamps none, or
//   history restored without it), which keeps the pre-#532 serialization.
// - The alias is re-verified per result: `text` must equal the join of
//   `raw.content`'s text blocks. Anything else — an older or newer edge that
//   derived `text` differently, a non-array `content` — keeps the full envelope,
//   so the projection can only ever remove a field that is reproducible from
//   what it keeps.
//
// Everything else passes through: `serverName`/`toolName` (identity), `isError`,
// and all of `raw` — ordered text blocks, `structuredContent` (semantically
// distinct even when a server also serializes it into a text block), media
// items and `_meta`. Separate calls are never compared with each other.
//
// This is a pure function of the recorded invocation, applied at message
// assembly time. The invocation itself — what the activity panel, the app
// policy's results (and so CanFactory's host pass-through, #170) and any future
// checkpoint (#531) see — keeps the authoritative envelope untouched, so
// replaying or restoring history re-derives the same projection and nothing
// lossy is ever stored.
//
// Kept in step with `buildMcpCallResponse` by tests that run that producer
// through this projection; it is not imported here so the producer stays out of
// the browser bundle.
const joinTextBlocks = (content: unknown): string | undefined =>
  Array.isArray(content)
    ? (content as Record<string, unknown>[])
        .flatMap((item) =>
          item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []
        )
        .join('\n')
    : undefined

export const modelFacingToolOutput = (invocation: ToolInvocation, output: unknown): unknown => {
  const source = invocation.source
  if (source?.kind !== 'mcp' || !output || typeof output !== 'object') return output
  const { text, ...projected } = output as Partial<McpCallResponse>
  const raw = projected.raw as { content?: unknown } | null | undefined
  return invocation.toolId === `mcp:${source.groupId}:${projected.toolName}` &&
    typeof projected.serverName === 'string' &&
    typeof projected.isError === 'boolean' &&
    typeof text === 'string' &&
    raw &&
    typeof raw === 'object' &&
    text === joinTextBlocks(raw.content)
    ? projected
    : output
}
