import { describe, expect, it } from 'vitest'
import {
  DOCS_DEV_WEBSOCKET_PATH,
  resolveDeployBase,
  resolveDocsBaseUrl,
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
})
