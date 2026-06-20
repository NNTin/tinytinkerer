import {
  clampChatMessageContent,
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  parseRetryAfterMs,
  type ChatMessage,
  type InspectorRequestPayload,
  type InspectorResponse,
  type InspectorUsage
} from '@tinytinkerer/contracts'
import type { SynthesisChunk } from '@tinytinkerer/app-core'
import { getTelemetryHeaders } from '../telemetry/telemetry'
import { extractUsageChunk, parseSseStream } from './sse-utils'

// The terminal usage chunk variant the SSE parser / extractUsageChunk yield.
type UsageChunk = Extract<SynthesisChunk, { kind: 'usage' }>
import {
  fetchWithTelemetry,
  type AcceptedOutcome,
  type RequestTelemetryMetadata
} from '../telemetry/request-telemetry'

type EdgeFetchOptions = {
  signal?: AbortSignal
  area?: string
  model?: string
  stream?: boolean
  // Outcomes this specific call treats as expected & non-actionable (never
  // captured). Falls back to DEFAULT_EDGE_ACCEPT when unset.
  accept?: AcceptedOutcome
}

export type EdgeFetch = (
  path: string,
  body: unknown,
  options?: EdgeFetchOptions
) => Promise<Response>

// Default expected-outcome triage shared by every edge model/agent call.
// Individual call sites (e.g. the synthesizer) may override via
// EdgeFetchOptions.accept when their reason text differs.
const DEFAULT_EDGE_ACCEPT: AcceptedOutcome = {
  kinds: ['abort'],
  status: [429],
  reason:
    'AbortError = runtime step-timeout / user cancel (TINYTINKERER-FRONTEND-A); 429 = the model service (LiteLLM) rate limiting the user as a cooldown via RateLimitError (TINYTINKERER-FRONTEND-9).'
}

// Builds an Error from a non-OK edge response, preferring the structured edge
// error payload and falling back to a caller-supplied message. Shared by the
// synthesizer (litellm-provider) and the ReAct decider (react-decider) so the
// edge error shape is parsed in exactly one place.
export const createEdgeError = async (response: Response, fallback: string): Promise<Error> => {
  const parsed = await response
    .clone()
    .json()
    .then((value) => edgeErrorResponseSchema.safeParse(value))
    .catch(() => undefined)

  return new Error(parsed?.success ? parsed.data.error : fallback)
}

export const createEdgeFetch = (
  baseUrl: string,
  getToken: () => string | null | undefined
): EdgeFetch =>
  async function edgeFetch(path, body, options) {
    const token = getToken()
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...getTelemetryHeaders()
    }
    if (token) {
      headers['authorization'] = `Bearer ${token}`
    }
    const url = `${baseUrl}${path}`
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (options?.signal) {
      init.signal = options.signal
    }
    const metadata: RequestTelemetryMetadata = {
      area: options?.area ?? path,
      origin: 'edge',
      method: 'POST',
      url,
      ...(options?.model ? { model: options.model } : {}),
      ...(options?.stream !== undefined ? { stream: options.stream } : {}),
      // Every edgeFetch is a cancellable model/agent call: the runtime aborts a
      // step on its idle timeout and the user can cancel an in-flight run, so an
      // AbortError is intentional control flow (TINYTINKERER-FRONTEND-A). A 429
      // is the model service (LiteLLM) rate limiting the user's own prompts: the
      // edge already returns a clean 429/Retry-After and every consumer funnels
      // it into a RateLimitError → cooldown banner, so it is expected, handled,
      // and unavoidable — not a captured error (TINYTINKERER-FRONTEND-9).
      accept: options?.accept ?? DEFAULT_EDGE_ACCEPT
    }
    return fetchWithTelemetry(metadata, init)
  }

export type ModelsChatInit = {
  model: string
  stream: boolean
  // Opt-in OpenAI-compatible streaming options. `include_usage` makes the
  // provider append a terminal usage chunk (forwarded verbatim by the edge) so
  // the context-usage gauge can read prompt-token counts. Spread into the request
  // body by modelsChatRequestBody.
  stream_options?: { include_usage?: boolean }
  messages: ChatMessage[]
}

type ModelsChatFetchOptions = {
  signal?: AbortSignal
  area?: string
  accept?: AcceptedOutcome
}

/**
 * A models/chat call bound to the runtime's LiteLLM deployment. Planners and
 * deciders consume this instead of a raw {@link EdgeFetch} so the deployment
 * base URL never appears in their signatures.
 */
export type ModelsChatFetch = (
  init: ModelsChatInit,
  options?: ModelsChatFetchOptions
) => Promise<Response>

// The single definition of the models/chat request body. `litellmBaseUrl` is
// included only when the user explicitly configured one — when absent the
// edge resolves its own configured deployment default (issue #179).
export const modelsChatRequestBody = (
  litellmBaseUrl: string | null | undefined,
  init: ModelsChatInit
): Record<string, unknown> => {
  const baseUrl = litellmBaseUrl?.trim()
  return {
    ...(baseUrl ? { litellmBaseUrl: baseUrl } : {}),
    ...init,
    // Clamp every message to the edge's per-message ceiling here — the single
    // place all chat requests (decide, synthesize, plan) are shaped — so an
    // oversized observation (e.g. a run_javascript result that returned the full
    // `dom` tree, or a large MCP response folded into the prompt) degrades
    // gracefully instead of tripping the edge's request validation, which answers
    // 400 "Invalid request" and ends the whole run (TINYTINKERER-FRONTEND-14/15).
    messages: init.messages.map((message) => ({
      ...message,
      content: clampChatMessageContent(message.content)
    }))
  }
}

// Optional developer hook: invoked with the EXACT body about to be forwarded for
// each model call, so the context-inspector plugin can show what was sent. It runs
// only when the host injects it (i.e. only while the inspector plugin is enabled),
// and it is the single chokepoint every chat request (plan / decide / synthesize)
// passes through, so it captures the post-clamp payload the edge forwards verbatim.
// It returns an updater the chokepoint calls once with the response outcome (or
// nothing if the host does not want the response). Never throws into the request
// path — capture is best-effort and side-effect-free for the model call.
export type ForwardedRequestSink = (
  payload: InspectorRequestPayload
) => ((response: InspectorResponse) => void) | void

// Cap on captured response content so a long answer can't balloon the in-memory
// inspector buffer. The panel is a debug view, not a transcript store.
const MAX_CAPTURED_RESPONSE_CHARS = 20_000

const toUsage = (chunk: UsageChunk): InspectorUsage => ({
  ...(chunk.promptTokens != null ? { promptTokens: chunk.promptTokens } : {}),
  ...(chunk.completionTokens != null ? { completionTokens: chunk.completionTokens } : {}),
  ...(chunk.totalTokens != null ? { totalTokens: chunk.totalTokens } : {})
})

// Read a successful response body (a tee'd clone, so the real consumer is
// untouched) and report its content + usage. Handles both the SSE stream
// (synthesize / streamed decide) and the non-streamed JSON body (decide / plan).
const readResponseBody = async (
  clone: Response,
  httpStatus: number,
  setResponse: (response: InspectorResponse) => void
): Promise<void> => {
  const contentType = clone.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('text/event-stream') && clone.body) {
      let content = ''
      let usage: InspectorUsage | undefined
      for await (const chunk of parseSseStream(clone.body, undefined)) {
        if (chunk.kind === 'content') content += chunk.text
        else if (chunk.kind === 'usage') usage = toUsage(chunk)
      }
      setResponse({
        status: 'ok',
        httpStatus,
        content: content.slice(0, MAX_CAPTURED_RESPONSE_CHARS),
        ...(usage ? { usage } : {})
      })
      return
    }

    const text = await clone.text()
    try {
      const json = JSON.parse(text) as Record<string, unknown>
      const choices = json['choices']
      const message = Array.isArray(choices)
        ? ((choices[0] as Record<string, unknown> | undefined)?.['message'] as
            | Record<string, unknown>
            | undefined)
        : undefined
      const rawContent = message?.['content']
      const content = typeof rawContent === 'string' ? rawContent : ''
      const usageChunk = extractUsageChunk(json)
      const usage = usageChunk && usageChunk.kind === 'usage' ? toUsage(usageChunk) : undefined
      setResponse({
        status: 'ok',
        httpStatus,
        content: content.slice(0, MAX_CAPTURED_RESPONSE_CHARS),
        ...(usage ? { usage } : {})
      })
    } catch {
      // Not JSON — keep the raw text (capped) so there is still something to show.
      setResponse({ status: 'ok', httpStatus, content: text.slice(0, MAX_CAPTURED_RESPONSE_CHARS) })
    }
  } catch {
    // A consumed/aborted body or read failure: record the success status with no
    // content rather than leaving the entry stuck on `pending`.
    setResponse({ status: 'ok', httpStatus, content: '' })
  }
}

// Pair the response outcome with a captured request. A 429 is a rate limit
// (rejected before the model ran — no tokens); any other non-OK status is an
// error; an OK response has its body tee'd and read in the background. Runs only
// for the side effect of updating the inspector; never affects the real consumer.
const captureResponse = (
  response: Response,
  setResponse: (response: InspectorResponse) => void
): void => {
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
    setResponse({
      status: 'rate_limited',
      httpStatus: 429,
      ...(retryAfterMs != null ? { retryAfterMs } : {})
    })
    return
  }
  if (!response.ok) {
    setResponse({ status: 'error', httpStatus: response.status })
    return
  }
  // Clone BEFORE the consumer reads the body. This runs in the chokepoint's own
  // `.then` (registered before the caller's await), so the tee is in place first.
  let clone: Response
  try {
    clone = response.clone()
  } catch {
    setResponse({ status: 'ok', httpStatus: response.status, content: '' })
    return
  }
  void readResponseBody(clone, response.status, setResponse)
}

export const createModelsChatFetch =
  (
    edgeFetch: EdgeFetch,
    getLiteLLMBaseUrl?: () => string | null | undefined,
    onForwardRequest?: ForwardedRequestSink
  ): ModelsChatFetch =>
  (init, options) => {
    const body = modelsChatRequestBody(getLiteLLMBaseUrl?.(), init)

    let setResponse: ((response: InspectorResponse) => void) | void = undefined
    if (onForwardRequest) {
      try {
        // Report the clamped messages (what actually leaves the client), not the
        // pre-clamp `init`, so the inspector mirrors the forwarded payload exactly.
        const messages = (body.messages as ChatMessage[]).map((message) => ({
          role: message.role,
          content: message.content
        }))
        setResponse = onForwardRequest({
          model: init.model,
          stream: init.stream,
          ...(init.stream_options ? { stream_options: init.stream_options } : {}),
          messages,
          ...(options?.area ? { area: options.area } : {}),
          capturedAt: new Date().toISOString()
        })
      } catch {
        // Capture must never break a chat request.
      }
    }

    const responsePromise = edgeFetch(EDGE_ROUTE_PATHS.modelsChat, body, {
      model: init.model,
      stream: init.stream,
      ...(options?.area ? { area: options.area } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.accept ? { accept: options.accept } : {})
    })

    if (setResponse) {
      const update = setResponse
      // Registered before the caller awaits the same promise, so the response is
      // tee'd before its body is consumed. Best-effort: capture must not perturb
      // the real request path, so failures fall back to an error outcome.
      responsePromise.then(
        (response) => captureResponse(response, update),
        (error) =>
          update({
            status: 'error',
            httpStatus: 0,
            message: error instanceof Error ? error.message : 'Request failed'
          })
      )
    }

    return responsePromise
  }
