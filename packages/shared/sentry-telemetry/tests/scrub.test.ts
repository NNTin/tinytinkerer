import { describe, expect, it } from 'vitest'
import type { Breadcrumb, Event } from '@sentry/core'

import { scrubBreadcrumb, scrubEvent, stripUrlQuery } from '../src/scrub.js'

describe('scrubEvent', () => {
  it('strips request body, query string, url query, and auth/cookie headers', () => {
    const event: Event = {
      request: {
        data: { message: 'secret user content' },
        query_string: 'token=secret',
        url: 'https://api.example.com/api/models/chat?token=secret',
        headers: {
          authorization: 'Bearer secret',
          Authorization: 'Bearer secret',
          cookie: 'session=secret',
          Cookie: 'session=secret',
          'content-type': 'application/json'
        }
      }
    }

    const scrubbed = scrubEvent(event)

    expect(scrubbed.request?.data).toBeUndefined()
    expect(scrubbed.request?.query_string).toBeUndefined()
    expect(scrubbed.request?.url).toBe('https://api.example.com/api/models/chat')
    expect(scrubbed.request?.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('returns events without a request untouched', () => {
    const event: Event = { message: 'boom' }
    expect(scrubEvent(event)).toBe(event)
  })
})

describe('scrubBreadcrumb', () => {
  it('drops non-error console breadcrumbs', () => {
    const breadcrumb: Breadcrumb = { category: 'console', level: 'log', message: 'noise' }
    expect(scrubBreadcrumb(breadcrumb)).toBeNull()
  })

  it('keeps error console breadcrumbs', () => {
    const breadcrumb: Breadcrumb = { category: 'console', level: 'error', message: 'boom' }
    expect(scrubBreadcrumb(breadcrumb)).toBe(breadcrumb)
  })

  it('strips the query string from fetch/xhr breadcrumb urls', () => {
    const breadcrumb: Breadcrumb = {
      category: 'fetch',
      data: { url: 'https://api.example.com/api/search?q=secret' }
    }
    const scrubbed = scrubBreadcrumb(breadcrumb)
    expect(scrubbed?.data?.url).toBe('https://api.example.com/api/search')
  })
})

describe('stripUrlQuery', () => {
  it('removes the query string', () => {
    expect(stripUrlQuery('https://x.test/a?b=c')).toBe('https://x.test/a')
  })

  it('leaves query-less and non-string values untouched', () => {
    expect(stripUrlQuery('https://x.test/a')).toBe('https://x.test/a')
    expect(stripUrlQuery(undefined)).toBeUndefined()
  })
})
