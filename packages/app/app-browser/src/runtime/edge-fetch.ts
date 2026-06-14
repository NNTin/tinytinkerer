import {
  EDGE_ROUTE_PATHS,
  edgeErrorResponseSchema,
  type ChatMessage
} from '@tinytinkerer/contracts'
import { getTelemetryHeaders } from '../telemetry/telemetry'
import {
  fetchWithTelemetry,
  type AcceptedOutcome,
  type RequestTelemetryMetadata
} from '../telemetry/request-telemetry'

export type EdgeFetchOptions = {
  signal?: AbortSignal
  area?: string
  model?: string
  stream?: boolean
  // Outcomes this specific call treats as expected & non-actionable (never
  // captured). Falls back to DEFAULT_EDGE_ACCEPT when unset.
  accept?: AcceptedOutcome
}

export type EdgeFetch = (path: string, body: unknown, options?: EdgeFetchOptions) => Promise<Response>

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
  messages: ChatMessage[]
}

export type ModelsChatFetchOptions = {
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
    ...init
  }
}

export const createModelsChatFetch = (
  edgeFetch: EdgeFetch,
  getLiteLLMBaseUrl?: () => string | null | undefined
): ModelsChatFetch =>
  (init, options) =>
    edgeFetch(
      EDGE_ROUTE_PATHS.modelsChat,
      modelsChatRequestBody(getLiteLLMBaseUrl?.(), init),
      {
        model: init.model,
        stream: init.stream,
        ...(options?.area ? { area: options.area } : {}),
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.accept ? { accept: options.accept } : {})
      }
    )
