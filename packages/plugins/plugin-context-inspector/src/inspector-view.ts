import type {
  InspectorEntry,
  InspectorMessageView,
  InspectorResponse,
  InspectorResponseView,
  InspectorSummarizer,
  InspectorView
} from '@tinytinkerer/contracts'

const SYSTEM_ROLE = 'system'

// A rate-limited (429) call is rejected before the model runs, so it bills no
// tokens. Surfaced verbatim in the panel so the behavior is unambiguous.
const RATE_LIMIT_NOTE =
  'Rate limited — the request was rejected before the model ran, so no tokens were consumed.'

const summarizeResponse = (response: InspectorResponse): InspectorResponseView => {
  switch (response.status) {
    case 'pending':
      return { status: 'pending', label: 'Waiting for response…' }
    case 'rate_limited':
      return {
        status: 'rate_limited',
        label: `Rate limited (HTTP ${response.httpStatus})`,
        note: RATE_LIMIT_NOTE,
        ...(response.retryAfterMs != null ? { retryAfterMs: response.retryAfterMs } : {})
      }
    case 'error':
      return {
        status: 'error',
        label: `Error (HTTP ${response.httpStatus})`,
        ...(response.message ? { message: response.message } : {})
      }
    case 'ok':
      return {
        status: 'ok',
        label: 'Response',
        content: response.content,
        ...(response.usage ? { usage: response.usage } : {}),
        approxResponseTokens: Math.ceil(response.content.length / 4)
      }
  }
}

// Rough per-message token estimate: ~4 characters per token. This is the SAME
// heuristic the runtime already uses for its throttle budget (see app-browser's
// estimateTokens) — deliberately an approximation, NOT a tokenizer count, so no
// tokenizer dependency is pulled in. The host shows the authoritative total from
// the provider's reported `usage.prompt_tokens` separately; this only powers the
// per-message breakdown the provider never itemizes.
const approxTokens = (text: string): number => Math.ceil(text.length / 4)

// Pure mapper: a captured request+response entry → an InspectorView the host
// renders. Never touches React/DOM (enforced by scripts/check-boundaries.mjs). It
// does not return null — the host decides when to show the panel (enabled + at
// least one captured entry); given an entry there is always something to show.
export const summarizeRequest: InspectorSummarizer = (entry: InspectorEntry): InspectorView => {
  const { request: payload, response } = entry
  const messages: InspectorMessageView[] = payload.messages.map((message, index) => ({
    index,
    role: message.role,
    isSystem: message.role === SYSTEM_ROLE,
    content: message.content,
    approxTokens: approxTokens(message.content)
  }))

  const approxTotalTokens = messages.reduce((sum, message) => sum + message.approxTokens, 0)

  // The exact forwarded body, pretty-printed for the host's JSON renderer and the
  // copy-to-clipboard affordance. Field order mirrors how the request is assembled
  // (model, stream, stream_options, messages) so it reads like the real payload.
  const rawJson = JSON.stringify(
    {
      model: payload.model,
      stream: payload.stream,
      ...(payload.stream_options ? { stream_options: payload.stream_options } : {}),
      messages: payload.messages
    },
    null,
    2
  )

  return {
    model: payload.model,
    stream: payload.stream,
    streamOptions: JSON.stringify(payload.stream_options ?? {}),
    ...(payload.area ? { area: payload.area } : {}),
    messageCount: messages.length,
    approxTotalTokens,
    messages,
    rawJson,
    response: summarizeResponse(response)
  }
}
