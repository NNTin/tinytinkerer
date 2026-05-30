import { captureTelemetryException } from './telemetry'

export type RequestTelemetryMetadata = {
  area: string
  origin: 'edge' | 'github'
  method: string
  url: string
  stream?: boolean
}

export type RequestTelemetryKind =
  | 'abort'
  | 'network_error'
  | 'http_error'
  | 'parse_error'
  | 'schema_error'

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

export const captureRequestIssue = (
  metadata: RequestTelemetryMetadata,
  issue: RequestTelemetryIssue
): void => {
  const error = normalizeError(issue.error, issue.message)
  if (markCaptured(error)) {
    return
  }

  captureTelemetryException(error, {
    level: issue.level ?? toLevel(issue.kind, issue.response),
    tags: buildRequestTags(metadata, issue.kind, issue.response),
    contexts: buildRequestContexts(metadata, issue.kind, issue.response)
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
