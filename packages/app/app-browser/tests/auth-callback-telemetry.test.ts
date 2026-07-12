// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCaptureExceptionSink, type CaptureExceptionSink } from '@tinytinkerer/sentry-telemetry'
import { completeGitHubOAuthCallback } from '../src/auth.js'
import type { BrowserApp } from '../src/app.js'

// The browser half of the OAuth-failure telemetry (issue #409). `missing_code`
// and `state_validation` throw before any network call, so they never reach the
// edge and would be invisible without a client-side capture; `code_exchange`
// records the login attempt's failure with the reason the edge relayed. None of
// these captures may carry the authorization code or a token.

const STORAGE_NS = 'test-ns'
const STATE_KEY = `${STORAGE_NS}:oauth_state`

const makeApp = (config: Record<string, unknown>): BrowserApp =>
  ({ shell: { config } }) as unknown as BrowserApp

const sink = vi.fn<CaptureExceptionSink>()

const oauthCapture = (step: string) =>
  sink.mock.calls.find(([, options]) => options.tags?.oauth_step === step)

beforeEach(() => {
  sink.mockReset()
  setCaptureExceptionSink(sink)
  sessionStorage.clear()
})

afterEach(() => {
  setCaptureExceptionSink(null)
  vi.unstubAllGlobals()
})

describe('completeGitHubOAuthCallback telemetry (issue #409)', () => {
  it('captures a missing authorization code', async () => {
    const app = makeApp({ storageNamespace: STORAGE_NS })

    await expect(completeGitHubOAuthCallback(app, { code: null, state: 'x' })).rejects.toThrow(
      'No authorization code received from GitHub.'
    )

    const call = oauthCapture('missing_code')
    if (!call) throw new Error('expected a missing_code capture')
    expect(call[1].tags).toMatchObject({ source: 'oauth', oauth_step: 'missing_code' })
    expect(call[1].fingerprint).toEqual(['oauth-callback', 'missing_code'])
  })

  it('captures an OAuth state mismatch (CSRF guard) before any network call', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('fetch must not be called')))
    vi.stubGlobal('fetch', fetchSpy)
    // No stored state, so validation fails regardless of the returned value.
    const app = makeApp({ storageNamespace: STORAGE_NS })

    await expect(
      completeGitHubOAuthCallback(app, { code: 'abcdefghij0123456789', state: 'mismatch' })
    ).rejects.toThrow('Authentication failed. Please try signing in again.')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(oauthCapture('state_validation')?.[1].fingerprint).toEqual([
      'oauth-callback',
      'state_validation'
    ])
  })

  it('captures a failed code exchange with the relayed reason and no secrets', async () => {
    sessionStorage.setItem(STATE_KEY, 'good-state')
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'incorrect_client_credentials' }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )
    const app = makeApp({ storageNamespace: STORAGE_NS, edgeBaseUrl: 'https://edge.test' })

    await expect(
      completeGitHubOAuthCallback(app, { code: 'the-secret-oauth-code', state: 'good-state' })
    ).rejects.toThrow('incorrect_client_credentials')

    const call = oauthCapture('code_exchange')
    if (!call) throw new Error('expected a code_exchange capture')
    const [error, options] = call
    expect(options.contexts?.oauth).toMatchObject({
      step: 'code_exchange',
      message: 'incorrect_client_credentials'
    })
    // The authorization code must never ride along in the telemetry payload.
    const serialized = JSON.stringify({ message: error.message, options })
    expect(serialized).not.toContain('the-secret-oauth-code')
  })
})
