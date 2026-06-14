import { captureTelemetryException } from './capture'

export type RequestTelemetryKind =
  | 'abort'
  | 'network_error'
  | 'http_error'
  | 'parse_error'
  | 'schema_error'

const MAX_RESPONSE_BODY_LENGTH = 1_000
const MAX_RAW_INPUT_LENGTH = 1_000

// Redact credential patterns before including a response body in Sentry context.
// LiteLLM error messages sometimes echo back the bearer key that was presented
// (e.g. "Received Key=sk-…"), so scrub sk-* and Bearer tokens defensively.
const scrubResponseBody = (body: string): string =>
  body
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9._-]{6,}/g, 'sk-[redacted]')

const RATE_LIMIT_RESPONSE_HEADERS = [
  'retry-after',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests'
] as const

const extractRateLimitHeaders = (response: Response): Record<string, string> => {
  const result: Record<string, string> = {}
  for (const header of RATE_LIMIT_RESPONSE_HEADERS) {
    const value = response.headers.get(header)
    if (value !== null) result[header] = value
  }
  return result
}

export type AcceptedOutcome = {
  /** HTTP status codes that are an expected, non-actionable outcome for this call. */
  status?: readonly number[]
  /** Failure kinds expected for this call (e.g. 'abort' where the user can cancel). */
  kinds?: readonly RequestTelemetryKind[]
  /** Why this is normal & unavoidable + the Sentry issue it settled. Required: no silent accepts. */
  reason: string
}

export type RequestTelemetryMetadata = {
  area: string
  // 'github' is the OAuth/identity API (token exchange, caller validation),
  // not an LLM provider.
  origin: 'edge' | 'github' | 'litellm' | 'tavily'
  method: string
  url: string
  model?: string | null
  stream?: boolean
  /**
   * Outcomes triaged as normal & unavoidable for this call site — never captured.
   * Add only after triaging the Sentry issue; see .agent/skills/sentry-debugging.
   */
  accept?: AcceptedOutcome
}

type RequestTelemetryIssue = {
  kind: RequestTelemetryKind
  message: string
  level?: 'warning' | 'error'
  response?: Response
  error?: unknown
  /**
   * Already-read (and scrubbed) response body. Pass this when the caller has
   * already consumed `response.body` — `captureRequestIssue` cannot clone and
   * re-read it at that point. In `fetchWithTelemetry` the clone is done
   * automatically; manual callers that read the body first should pass it here.
   */
  responseBody?: string
  /**
   * Raw text being parsed, for `parse_error` / `schema_error` events. Included
   * in the `failure` context (truncated) so future agents can see what the model
   * or upstream returned without needing to fetch breadcrumbs or replays.
   */
  rawInput?: string
}

const CAPTURED_REQUEST_ERROR = Symbol('capturedRequestError')

const stripUrlQuery = (value: string): string => {
  const queryIndex = value.indexOf('?')
  return queryIndex === -1 ? value : value.slice(0, queryIndex)
}

const sanitizeRequestLocation = (
  value: string
): { host?: string; path: string } => {
  const sanitized = stripUrlQuery(value)
  try {
    const url = new URL(sanitized)
    return { host: url.host, path: url.pathname }
  } catch {
    return { path: sanitized }
  }
}

const normalizeError = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(typeof error === 'string' ? error : fallback)

const markCaptured = (error: Error): boolean => {
  const candidate = error as Error & { [CAPTURED_REQUEST_ERROR]?: boolean }
  if (candidate[CAPTURED_REQUEST_ERROR]) {
    return true
  }
  candidate[CAPTURED_REQUEST_ERROR] = true
  return false
}

const toLevel = (
  kind: RequestTelemetryKind,
  response?: Response
): 'warning' | 'error' => {
  if (kind === 'abort') {
    return 'warning'
  }
  if (kind === 'http_error' && response && response.status < 500) {
    return 'warning'
  }
  return 'error'
}

const SAFE_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/
const MAX_TAG_VALUE_LENGTH = 200

const hashString = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const sanitizeModelForTelemetry = (model: string | null | undefined): string | undefined => {
  const trimmed = model?.trim()
  if (!trimmed) {
    return undefined
  }

  const hash = hashString(trimmed)
  if (!SAFE_MODEL_ID_PATTERN.test(trimmed)) {
    return `custom:${hash}`
  }
  if (trimmed.length <= MAX_TAG_VALUE_LENGTH) {
    return trimmed
  }

  return `${trimmed.slice(0, MAX_TAG_VALUE_LENGTH - hash.length - 1)}:${hash}`
}

const buildRequestTags = (
  metadata: RequestTelemetryMetadata,
  kind: RequestTelemetryKind,
  response?: Response
): Record<string, string | number | boolean | undefined> => {
  const model = sanitizeModelForTelemetry(metadata.model)
  const { host, path } = sanitizeRequestLocation(metadata.url)
  return {
    request_area: metadata.area,
    request_origin: metadata.origin,
    http_method: metadata.method,
    http_status: response?.status,
    failure_kind: kind,
    stream: metadata.stream ?? false,
    model,
    // Promote path and host to searchable Sentry tags (they are also in the
    // `request` context but tags are filterable across issues).
    path,
    ...(host ? { host } : {})
  }
}

// Group captured request failures by what actually distinguishes them — the
// call area, failure kind, and (for http_error) the status — instead of the
// shared `normalizeError` frame they all flow through. This stops unrelated
// endpoints/statuses from conflating into a single Sentry issue (the EDGE-4
// pile-up of models.list 429 + models.chat 429 + chat 401 under one id).
const buildRequestFingerprint = (
  metadata: RequestTelemetryMetadata,
  kind: RequestTelemetryKind,
  response?: Response
): string[] => {
  const model = sanitizeModelForTelemetry(metadata.model)
  return [
    'request-telemetry',
    metadata.area,
    kind,
    ...(response ? [String(response.status)] : []),
    ...(model ? [`model:${model}`] : [])
  ]
}

const buildRequestContexts = (
  metadata: RequestTelemetryMetadata,
  kind: RequestTelemetryKind,
  response?: Response,
  responseBody?: string,
  rawInput?: string
): Record<string, Record<string, unknown>> => {
  const model = sanitizeModelForTelemetry(metadata.model)
  return {
    request: {
      area: metadata.area,
      origin: metadata.origin,
      method: metadata.method,
      ...sanitizeRequestLocation(metadata.url),
      stream: metadata.stream ?? false,
      ...(model ? { model } : {})
    },
    failure: {
      kind,
      // Raw text that failed to parse — lets future agents see what the model
      // or upstream actually returned without needing breadcrumbs or replays.
      ...(rawInput !== undefined
        ? { raw_input: rawInput.slice(0, MAX_RAW_INPUT_LENGTH) }
        : {})
    },
    ...(response
      ? {
          response: {
            status: response.status,
            statusText: response.statusText,
            // Upstream error body (scrubbed, truncated) — avoids having to
            // fetch breadcrumbs or the raw response to see WHY a request failed.
            ...(responseBody !== undefined
              ? { body: responseBody.slice(0, MAX_RESPONSE_BODY_LENGTH) }
              : {}),
            // Rate-limit headers on any response that carries them (not just
            // 429s — some upstreams return Retry-After on 503 too).
            ...extractRateLimitHeaders(response)
          }
        }
      : {})
  }
}

const classifyErrorKind = (error: Error): RequestTelemetryKind =>
  error.name === 'AbortError' ? 'abort' : 'network_error'

const isAcceptedOutcome = (
  metadata: RequestTelemetryMetadata,
  kind: RequestTelemetryKind,
  response?: Response
): boolean => {
  const accept = metadata.accept
  if (!accept) {
    return false
  }
  if (accept.kinds?.includes(kind)) {
    return true
  }
  if (response && accept.status?.includes(response.status)) {
    return true
  }
  return false
}

export const captureRequestIssue = (
  metadata: RequestTelemetryMetadata,
  issue: RequestTelemetryIssue
): void => {
  if (isAcceptedOutcome(metadata, issue.kind, issue.response)) {
    return
  }
  const error = normalizeError(issue.error, issue.message)
  if (markCaptured(error)) {
    return
  }

  captureTelemetryException(error, {
    level: issue.level ?? toLevel(issue.kind, issue.response),
    tags: buildRequestTags(metadata, issue.kind, issue.response),
    contexts: buildRequestContexts(
      metadata,
      issue.kind,
      issue.response,
      issue.responseBody,
      issue.rawInput
    ),
    fingerprint: buildRequestFingerprint(metadata, issue.kind, issue.response)
  })
}

export const fetchWithTelemetry = async (
  metadata: RequestTelemetryMetadata,
  init: RequestInit
): Promise<Response> => {
  try {
    // eslint-disable-next-line no-restricted-globals -- this IS the fetchWithTelemetry wrapper; it must call the raw global fetch internally.
    const response = await fetch(metadata.url, init)
    if (!response.ok) {
      const location = sanitizeRequestLocation(metadata.url)
      // Clone before reading so the caller can still consume the original body.
      // Error responses are typically short JSON; the clone's body is read once
      // and discarded. On failure (e.g. the body is a locked stream) we capture
      // without body rather than surfacing a secondary error.
      const bodyText = await response.clone().text().catch(() => undefined)
      const scrubbedBody =
        bodyText !== undefined ? scrubResponseBody(bodyText) : undefined
      captureRequestIssue(metadata, {
        kind: 'http_error',
        message: `${metadata.method} ${location.path} failed (${response.status})`,
        response,
        ...(scrubbedBody !== undefined ? { responseBody: scrubbedBody } : {})
      })
    }
    return response
  } catch (error) {
    const location = sanitizeRequestLocation(metadata.url)
    const normalizedError = normalizeError(error, `${metadata.method} ${location.path} failed`)
    captureRequestIssue(metadata, {
      kind: classifyErrorKind(normalizedError),
      message: normalizedError.message,
      error: normalizedError
    })
    throw error
  }
}

export const parseJsonWithTelemetry = async <T>(
  metadata: RequestTelemetryMetadata,
  response: Response
): Promise<T> => {
  try {
    return (await response.json()) as T
  } catch (error) {
    const normalizedError = normalizeError(error, 'Failed to parse JSON response')
    captureRequestIssue(metadata, {
      kind: normalizedError.name === 'AbortError' ? 'abort' : 'parse_error',
      message: normalizedError.message,
      response,
      error: normalizedError
    })
    throw error
  }
}

export const tryParseJsonWithTelemetry = async <T>(
  metadata: RequestTelemetryMetadata,
  response: Response
): Promise<T | undefined> => {
  try {
    return await parseJsonWithTelemetry<T>(metadata, response)
  } catch {
    return undefined
  }
}

export const parseWithTelemetry = <T>(
  metadata: RequestTelemetryMetadata,
  kind: Extract<RequestTelemetryKind, 'parse_error' | 'schema_error'>,
  message: string,
  parse: () => T,
  response?: Response,
  /**
   * Raw text being parsed. When provided, included in the `failure.raw_input`
   * context (truncated to {@link MAX_RAW_INPUT_LENGTH}) so future agents can
   * see what the model or upstream actually returned without needing replays.
   */
  rawInput?: string
): T => {
  try {
    return parse()
  } catch (error) {
    const normalizedError = normalizeError(error, message)
    captureRequestIssue(metadata, {
      kind,
      message,
      error: normalizedError,
      ...(response ? { response } : {}),
      ...(rawInput !== undefined ? { rawInput } : {})
    })
    throw error
  }
}
