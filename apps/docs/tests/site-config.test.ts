import { describe, expect, it } from 'vitest'
import {
  DOCS_DEV_WEBSOCKET_PATH,
  resolveDeployBase,
  resolveDocsBaseUrl,
  resolveDocsLabCustomFields,
  resolveProductBaseUrl
} from '../site-config'

describe('documentation site paths', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['/', ''],
    ['/tinytinkerer', 'tinytinkerer'],
    ['/tinytinkerer/', 'tinytinkerer']
  ])('normalizes deploy base %s', (value, expected) => {
    expect(resolveDeployBase(value)).toBe(expected)
  })

  it.each([
    [undefined, '/docs/'],
    ['', '/docs/'],
    ['/', '/docs/'],
    ['/tinytinkerer', '/tinytinkerer/docs/'],
    ['/tinytinkerer/', '/tinytinkerer/docs/']
  ])('resolves the docs base URL for %s', (value, expected) => {
    expect(resolveDocsBaseUrl(value)).toBe(expected)
  })

  it.each([
    [undefined, '/'],
    ['', '/'],
    ['/tinytinkerer', '/tinytinkerer/'],
    ['/tinytinkerer/', '/tinytinkerer/']
  ])('resolves the product URL for %s', (value, expected) => {
    expect(resolveProductBaseUrl(value)).toBe(expected)
  })

  it('exposes webpack-dev-server HMR through its default socket path', () => {
    expect(DOCS_DEV_WEBSOCKET_PATH).toBe('/ws')
  })

  it('carries the LiveLab framework its edge/GitHub-OAuth config, namespaced under tiny*', () => {
    expect(
      resolveDocsLabCustomFields(undefined, {
        edgeBaseUrl: 'https://edge.example',
        githubClientId: 'abc123',
        sentryDsn: 'https://sentry.example/1',
        sentryEnvironment: 'production'
      })
    ).toEqual({
      tinyEdgeBaseUrl: 'https://edge.example',
      tinyGithubClientId: 'abc123',
      tinySentryDsn: 'https://sentry.example/1',
      tinySentryEnvironment: 'production',
      tinyProductBaseUrl: '/'
    })
  })

  it('defaults an absent edge base URL to an empty string, not undefined', () => {
    expect(resolveDocsLabCustomFields(undefined, {}).tinyEdgeBaseUrl).toBe('')
  })

  it('resolves the product base URL for a preview deploy base', () => {
    expect(resolveDocsLabCustomFields('/pr-42', {}).tinyProductBaseUrl).toBe('/pr-42/')
  })
})
