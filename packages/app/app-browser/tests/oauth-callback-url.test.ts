// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readOAuthCallbackParams, urlHasOAuthCode } from '../src/oauth-callback-url.js'

// The redirect_uri every shell registers is hash-routed ('…/#/auth/callback'), so
// GitHub's code/state response can land in EITHER window.location.search or the
// hash fragment's query part depending on how the redirect_uri was constructed.
// These pin down both sources, that search wins when both are present, and the
// derived urlHasOAuthCode() helper the watchdog uses.

const setLocation = (search: string, hash: string): void => {
  window.history.replaceState(null, '', `/${search}${hash}`)
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('readOAuthCallbackParams', () => {
  it('reads code/state from the query string', () => {
    setLocation('?code=abc123&state=xyz', '')

    expect(readOAuthCallbackParams()).toEqual({ code: 'abc123', state: 'xyz' })
  })

  it('reads code/state from the hash fragment when the query string is empty', () => {
    setLocation('', '#/auth/callback?code=abc123&state=xyz')

    expect(readOAuthCallbackParams()).toEqual({ code: 'abc123', state: 'xyz' })
  })

  it('returns null code/state when neither the query nor the hash carries a code', () => {
    setLocation('', '#/auth/callback')

    expect(readOAuthCallbackParams()).toEqual({ code: null, state: null })
  })

  it('prefers the query string when both the query and the hash carry a code', () => {
    setLocation(
      '?code=from-search&state=search-state',
      '#/auth/callback?code=from-hash&state=hash-state'
    )

    expect(readOAuthCallbackParams()).toEqual({ code: 'from-search', state: 'search-state' })
  })
})

describe('urlHasOAuthCode', () => {
  it('is true when a code is present', () => {
    setLocation('?code=abc123', '')

    expect(urlHasOAuthCode()).toBe(true)
  })

  it('is false when no code is present', () => {
    setLocation('', '#/auth/callback')

    expect(urlHasOAuthCode()).toBe(false)
  })
})
