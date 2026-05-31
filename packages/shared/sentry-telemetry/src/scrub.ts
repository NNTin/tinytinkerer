// Unified PII scrubbers shared by the browser (`@sentry/react`) and edge
// (`@sentry/cloudflare`) `beforeSend` / `beforeBreadcrumb` hooks. Types come from
// `@sentry/core` (the base both SDKs build on) and are erased at build time, so
// this file carries no Sentry runtime dependency. Generics preserve the caller's
// concrete event type (e.g. `ErrorEvent`) through the hook signature.

import type { Breadcrumb, Event } from '@sentry/core'

/**
 * Removes the query string from a URL so events/breadcrumbs never carry request
 * payloads encoded as query params. Returns non-string input untouched.
 */
export const stripUrlQuery = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }
  const queryIndex = value.indexOf('?')
  return queryIndex === -1 ? value : value.slice(0, queryIndex)
}

/**
 * Strips user content and credentials from an outgoing Sentry event: request
 * body, query string, URL query, and auth/cookie headers. Mutates and returns
 * the same event. Wire as `beforeSend`. See docs/PRIVACY.md.
 */
export const scrubEvent = <T extends Event>(event: T): T => {
  const request = event.request
  if (request) {
    delete request.data
    delete request.query_string
    if (request.headers) {
      delete request.headers['authorization']
      delete request.headers['Authorization']
      delete request.headers['cookie']
      delete request.headers['Cookie']
    }
    if (typeof request.url === 'string') {
      request.url = stripUrlQuery(request.url) as string
    }
  }
  return event
}

/**
 * Drops noisy/PII breadcrumbs before they attach to an event: non-error console
 * logs are removed entirely, and fetch/xhr URLs have their query stripped. Wire
 * as `beforeBreadcrumb`. Returns `null` to drop the breadcrumb.
 */
export const scrubBreadcrumb = <T extends Breadcrumb>(breadcrumb: T): T | null => {
  if (
    breadcrumb.category === 'console' &&
    breadcrumb.level !== 'error' &&
    breadcrumb.level !== 'fatal'
  ) {
    return null
  }
  if (
    (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') &&
    breadcrumb.data
  ) {
    breadcrumb.data.url = stripUrlQuery(breadcrumb.data.url)
  }
  return breadcrumb
}
