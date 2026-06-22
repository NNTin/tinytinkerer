import {
  clampChatMessageContent,
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  parseRetryAfterMs,
  type ChatMessage,
  type ChatToolDefinition,
  type InspectorRequestPayload,
  type InspectorResponse,
  type InspectorUsage,
  type ToolChoice
} from '@tinytinkerer/contracts'
import type { SynthesisChunk } from '@tinytinkerer/app-core'
import { captureTelemetryException, getTelemetryHeaders } from '../telemetry/telemetry'
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
  // Native tool calling (issue #276): the tools advertised to the model and the
  // policy for using them. Forwarded verbatim by the edge when present.
  tools?: ChatToolDefinition[]
  tool_choice?: ToolChoice
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
    // Clamp string content only: an assistant tool-call turn carries `content:
    // null` (its payload is the `tool_calls`), so leave non-string content as-is
    // and preserve the tool_calls / tool_call_id fields via the spread (#276).
    messages: init.messages.map((message) =>
      typeof message.content === 'string'
        ? { ...message, content: clampChatMessageContent(message.content) }
        : message
    )
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

// Metadata for telemetry when response capture fails. Carries ONLY the request
// area and model — never the conversation payload or response content (#270 keeps
// the inspector payload entirely client-side). `signal` lets us tell an expected
// cancellation apart from a genuine capture failure.
type InspectorCaptureContext = {
  area?: string
  model: string
  signal?: AbortSignal
}

// Where in the capture pipeline the response went missing, so a future agent can
// see which path failed from the Sentry tag alone:
//   clone      — response.clone() threw before we could tee the body
//   read       — reading the tee'd body threw (and it was not an abort)
//   empty      — a 200 OK body was read fully but yielded no content
//   unexpected — the capture closure itself threw, leaving the entry pending
type InspectorCaptureStage = 'clone' | 'read' | 'empty' | 'unexpected'

// Surface a context-inspector response-capture failure to telemetry so a missing
// response in the panel is NOT a silent gap (a future agent can investigate from
// the issue). METADATA ONLY — the request payload and response content must never
// leave the client (#270 privacy), so we attach area/model/stage/detail where
// `detail` is a stream/abort error message, never message content.
//
// Expected cancellations are skipped: when the user cancels or a ReAct decision
// step times out (attemptDecision aborts its own controller), the tee'd read
// aborts too — that is normal, not a defect, mirroring how createEdgeFetch already
// declines to capture AbortError/429.
const reportInspectorCaptureFailure = (
  stage: InspectorCaptureStage,
  context: InspectorCaptureContext,
  detail?: unknown
): void => {
  if (context.signal?.aborted) return
  if (detail instanceof Error && detail.name === 'AbortError') return

  const detailMessage =
    detail instanceof Error ? detail.message : typeof detail === 'string' ? detail : ''
  captureTelemetryException(
    new Error(
      `context-inspector response capture failed (${stage})${detailMessage ? `: ${detailMessage}` : ''}`
    ),
    {
      level: 'error',
      tags: {
        source: 'context-inspector',
        capture_stage: stage,
        request_area: context.area ?? 'models.chat',
        model: context.model
      },
      // One issue per (stage, area) so the four failure modes stay distinct rather
      // than collapsing under the shared Error frame.
      fingerprint: ['context-inspector-capture', stage, context.area ?? 'models.chat']
    }
  )
}

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
  setResponse: (response: InspectorResponse) => void,
  context: InspectorCaptureContext
): Promise<void> => {
  const contentType = clone.headers.get('content-type') ?? ''
  // A 200 OK whose body read clean but produced nothing is the "response missing"
  // case the panel shows; flag it (non-abort only) so it is observable.
  const reportIfEmpty = (content: string): void => {
    if (content.length === 0) reportInspectorCaptureFailure('empty', context)
  }
  try {
    if (contentType.includes('text/event-stream') && clone.body) {
      let content = ''
      let usage: InspectorUsage | undefined
      for await (const chunk of parseSseStream(clone.body, undefined)) {
        if (chunk.kind === 'content') content += chunk.text
        else if (chunk.kind === 'usage') usage = toUsage(chunk)
      }
      reportIfEmpty(content)
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
      reportIfEmpty(content)
      setResponse({
        status: 'ok',
        httpStatus,
        content: content.slice(0, MAX_CAPTURED_RESPONSE_CHARS),
        ...(usage ? { usage } : {})
      })
    } catch {
      // Not JSON — keep the raw text (capped) so there is still something to show.
      reportIfEmpty(text)
      setResponse({ status: 'ok', httpStatus, content: text.slice(0, MAX_CAPTURED_RESPONSE_CHARS) })
    }
  } catch (error) {
    // A read failure leaves the panel without a response. An aborted body (user
    // cancel / ReAct decision timeout) is expected and filtered out inside the
    // reporter; anything else is surfaced so it is not silent.
    reportInspectorCaptureFailure('read', context, error)
    setResponse({ status: 'ok', httpStatus, content: '' })
  }
}

// Pair the response outcome with a captured request. A 429 is a rate limit
// (rejected before the model ran — no tokens); any other non-OK status is an
// error; an OK response has its body tee'd and read in the background. Runs only
// for the side effect of updating the inspector; never affects the real consumer.
const captureResponse = (
  response: Response,
  setResponse: (response: InspectorResponse) => void,
  context: InspectorCaptureContext
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
  } catch (error) {
    // The body was already disturbed/locked before we could tee it — the panel
    // would show an empty response, so surface why (non-abort only).
    reportInspectorCaptureFailure('clone', context, error)
    setResponse({ status: 'ok', httpStatus: response.status, content: '' })
    return
  }
  void readResponseBody(clone, response.status, setResponse, context)
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
        // Native tool calling (issue #276): preserve the STRUCTURED tool fields
        // (content may be null on a tool-call turn, plus tool_calls / tool_call_id)
        // so the inspector can show the tools used, not just prose.
        const messages = (body.messages as ChatMessage[]).map((message) => ({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : null,
          ...('tool_calls' in message && message.tool_calls
            ? { tool_calls: message.tool_calls }
            : {}),
          ...('tool_call_id' in message && message.tool_call_id
            ? { tool_call_id: message.tool_call_id }
            : {})
        }))
        setResponse = onForwardRequest({
          model: init.model,
          stream: init.stream,
          ...(init.stream_options ? { stream_options: init.stream_options } : {}),
          messages,
          // Carry the advertised tools + policy so the inspector shows what the
          // model could call this turn (issue #276). Normalize each tool so an
          // absent description/parameters is omitted (not set to `undefined`),
          // satisfying the inspector view contract under exactOptionalPropertyTypes.
          ...(init.tools && init.tools.length > 0
            ? {
                tools: init.tools.map((tool) => ({
                  type: tool.type,
                  function: {
                    name: tool.function.name,
                    ...(tool.function.description
                      ? { description: tool.function.description }
                      : {}),
                    ...(tool.function.parameters ? { parameters: tool.function.parameters } : {})
                  }
                }))
              }
            : {}),
          ...(init.tool_choice ? { tool_choice: init.tool_choice } : {}),
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
      const captureContext: InspectorCaptureContext = {
        ...(options?.area ? { area: options.area } : {}),
        model: init.model,
        ...(options?.signal ? { signal: options.signal } : {})
      }
      // Registered before the caller awaits the same promise, so the response is
      // tee'd before its body is consumed. Best-effort: capture must not perturb
      // the real request path, so failures fall back to an error outcome. A throw
      // inside the fulfilled handler would otherwise leave the entry stuck on
      // `pending` (a silent missing response), so guard it and surface it.
      responsePromise.then(
        (response) => {
          try {
            captureResponse(response, update, captureContext)
          } catch (error) {
            reportInspectorCaptureFailure('unexpected', captureContext, error)
            update({
              status: 'error',
              httpStatus: 0,
              message: error instanceof Error ? error.message : 'Capture failed'
            })
          }
        },
        (error) =>
          // The request itself rejected (network error / abort). edge-fetch already
          // owns telemetry for those, so record the inspector outcome without
          // double-reporting here.
          update({
            status: 'error',
            httpStatus: 0,
            message: error instanceof Error ? error.message : 'Request failed'
          })
      )
    }

    return responsePromise
  }
