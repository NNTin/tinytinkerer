import {
  clampChatMessageContent,
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  type ChatMessage,
  type InspectorRequestPayload
} from '@tinytinkerer/contracts'
import { getTelemetryHeaders } from '../telemetry/telemetry'
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
// Never throws into the request path — capture is best-effort and side-effect-free
// for the model call.
export type ForwardedRequestSink = (payload: InspectorRequestPayload) => void

export const createModelsChatFetch =
  (
    edgeFetch: EdgeFetch,
    getLiteLLMBaseUrl?: () => string | null | undefined,
    onForwardRequest?: ForwardedRequestSink
  ): ModelsChatFetch =>
  (init, options) => {
    const body = modelsChatRequestBody(getLiteLLMBaseUrl?.(), init)

    if (onForwardRequest) {
      try {
        // Report the clamped messages (what actually leaves the client), not the
        // pre-clamp `init`, so the inspector mirrors the forwarded payload exactly.
        const messages = (body.messages as ChatMessage[]).map((message) => ({
          role: message.role,
          content: message.content
        }))
        onForwardRequest({
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

    return edgeFetch(EDGE_ROUTE_PATHS.modelsChat, body, {
      model: init.model,
      stream: init.stream,
      ...(options?.area ? { area: options.area } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.accept ? { accept: options.accept } : {})
    })
  }
