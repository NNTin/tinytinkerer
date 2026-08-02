import { describe, expect, it } from 'vitest'
import {
  DOCS_DEV_WEBSOCKET_PATH,
  resolveDeployBase,
  resolveDocsBaseUrl,
  resolveDocsAssistantEnabled,
  resolveDocsRuntimeCustomFields,
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

  it('carries both docs BrowserApps their edge/GitHub-OAuth config, namespaced under tiny*', () => {
    expect(
      resolveDocsRuntimeCustomFields(undefined, {
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
      tinyProductBaseUrl: '/',
      tinyDocsAssistantEnabled: true
    })
  })

  it('defaults an absent edge base URL to an empty string, not undefined', () => {
    expect(resolveDocsRuntimeCustomFields(undefined, {}).tinyEdgeBaseUrl).toBe('')
  })

  it('resolves the product base URL for a preview deploy base', () => {
    expect(resolveDocsRuntimeCustomFields('/pr-42', {}).tinyProductBaseUrl).toBe('/pr-42/')
  })
})

// Issue #481's rollback switch. The asymmetry is the point: only the documented
// off-values disable the assistant, so a typo, an empty string from an unset CI
// variable, or a well-meant `TINYTINKERER_DOCS_ASSISTANT=disabled` all leave a
// production deployment with its assistant intact rather than silently removing
// a shipped feature.
describe('the documentation assistant rollback switch', () => {
  it.each([undefined, '', '  ', 'on', 'true', '1', 'yes', 'disabled', 'OFFLINE'])(
    'stays enabled for %o',
    (value) => {
      expect(resolveDocsAssistantEnabled(value)).toBe(true)
    }
  )

  it.each(['off', 'OFF', ' Off ', 'false', 'FALSE', '0'])('is disabled by %o', (value) => {
    expect(resolveDocsAssistantEnabled(value)).toBe(false)
  })

  it('threads the resolved switch into the custom fields the pages carry', () => {
    expect(
      resolveDocsRuntimeCustomFields(undefined, { docsAssistant: 'off' }).tinyDocsAssistantEnabled
    ).toBe(false)
  })
})
