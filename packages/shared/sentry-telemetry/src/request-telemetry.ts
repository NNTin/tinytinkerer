import { captureTelemetryException } from './capture'

export type RequestTelemetryKind =
  | 'abort'
  | 'network_error'
  | 'http_error'
  | 'parse_error'
  | 'schema_error'

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
  origin: 'edge' | 'github' | 'tavily'
  method: string
  url: string
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

const buildRequestTags = (
  metadata: RequestTelemetryMetadata,
  kind: RequestTelemetryKind,
  response?: Response
): Record<string, string | number | boolean | undefined> => ({
  request_area: metadata.area,
  request_origin: metadata.origin,
  http_method: metadata.method,
  http_status: response?.status,
  failure_kind: kind,
  stream: metadata.stream ?? false
})

// Group captured request failures by what actually distinguishes them — the
// call area, failure kind, and (for http_error) the status — instead of the
// shared `normalizeError` frame they all flow through. This stops unrelated
// endpoints/statuses from conflating into a single Sentry issue (the EDGE-4
// pile-up of models.list 429 + models.chat 429 + chat 401 under one id).
const buildRequestFingerprint = (
  metadata: RequestTelemetryMetadata,
  kind: RequestTelemetryKind,
  response?: Response
): string[] => [
  'request-telemetry',
  metadata.area,
  kind,
  ...(response ? [String(response.status)] : [])
]

const buildRequestContexts = (
  metadata: RequestTelemetryMetadata,
  kind: RequestTelemetryKind,
  response?: Response
): Record<string, Record<string, unknown>> => ({
  request: {
    area: metadata.area,
    origin: metadata.origin,
    method: metadata.method,
    ...sanitizeRequestLocation(metadata.url),
    stream: metadata.stream ?? false
  },
  failure: {
    kind
  },
  ...(response
    ? {
        response: {
          status: response.status,
          statusText: response.statusText
        }
      }
    : {})
})

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
    contexts: buildRequestContexts(metadata, issue.kind, issue.response),
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
      captureRequestIssue(metadata, {
        kind: 'http_error',
        message: `${metadata.method} ${location.path} failed (${response.status})`,
        response
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
  response?: Response
): T => {
  try {
    return parse()
  } catch (error) {
    const normalizedError = normalizeError(error, message)
    captureRequestIssue(metadata, {
      kind,
      message,
      error: normalizedError,
      ...(response ? { response } : {})
    })
    throw error
  }
}
