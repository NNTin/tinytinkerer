import { describe, expect, it } from 'vitest'
import { resolveBrowserShellBootstrapConfig, resolveBrowserShellConfig } from '../src/config.js'

describe('resolveBrowserShellBootstrapConfig', () => {
  it('derives the GitHub callback from the current origin and base path', () => {
    expect(
      resolveBrowserShellBootstrapConfig({
        baseUrl: '/web/',
        origin: 'http://localhost:3111',
        githubClientId: 'client-id'
      })
    ).toMatchObject({
      githubClientId: 'client-id',
      githubRedirectUri: 'http://localhost:3111/web/#/auth/callback',
      storageNamespace: 'tinytinkerer',
      authMode: 'hybrid'
    })
  })

  // The browser shells (web/widget/mobile) share ONE build served at three
  // paths, so they ship with a RELATIVE Vite base (`./`) rather than an absolute
  // one. The callback must still resolve to a well-formed URL — the origin root,
  // where apps/host handles it — not the malformed `https://host./…` the old
  // `origin + baseUrl` concatenation produced.
  it('resolves a relative base ("./") to the origin-root callback', () => {
    expect(
      resolveBrowserShellBootstrapConfig({
        baseUrl: './',
        origin: 'https://dev.tiny.nntin.xyz',
        githubClientId: 'client-id'
      }).githubRedirectUri
    ).toBe('https://dev.tiny.nntin.xyz/#/auth/callback')
  })

  it('resolves a relative base against a localhost:port origin without producing an invalid URL', () => {
    // `http://localhost:40123` + `./` string-joined is `http://localhost:40123./…`
    // whose `:40123.` is an illegal port — the old code threw here.
    expect(
      resolveBrowserShellBootstrapConfig({
        baseUrl: './',
        origin: 'http://localhost:40123',
        githubClientId: 'client-id'
      }).githubRedirectUri
    ).toBe('http://localhost:40123/#/auth/callback')
  })

  it('prefers an explicit redirect URI and preserves shell overrides', () => {
    expect(
      resolveBrowserShellBootstrapConfig({
        baseUrl: '/widget/',
        origin: 'https://preview.example',
        edgeBaseUrl: 'https://edge.example',
        storageNamespace: 'tinytinkerer-widget',
        authMode: 'oauth',
        hostToken: 'host-token',
        manifestStartUrl: '/widget/',
        githubClientId: 'client-id',
        githubRedirectUri: 'https://embed.example/widget/#/auth/callback'
      })
    ).toEqual({
      edgeBaseUrl: 'https://edge.example',
      storageNamespace: 'tinytinkerer-widget',
      authMode: 'oauth',
      hostToken: 'host-token',
      manifestStartUrl: '/widget/',
      githubClientId: 'client-id',
      githubRedirectUri: 'https://embed.example/widget/#/auth/callback',
      appVersion: 'dev',
      buildHash: 'dev'
    })
  })

  it('omits OAuth fields when GitHub auth is not configured', () => {
    expect(
      resolveBrowserShellBootstrapConfig({
        baseUrl: '/mobile/',
        origin: 'http://localhost:3111'
      })
    ).toEqual({
      edgeBaseUrl: '',
      storageNamespace: 'tinytinkerer',
      authMode: 'hybrid',
      hostToken: null,
      appVersion: 'dev',
      buildHash: 'dev'
    })
  })

  it('passes the Sentry environment through only when provided', () => {
    expect(
      resolveBrowserShellBootstrapConfig({
        baseUrl: '/web/',
        origin: 'http://localhost:3111',
        sentryEnvironment: 'develop'
      })
    ).toMatchObject({ sentryEnvironment: 'develop' })

    expect(
      resolveBrowserShellBootstrapConfig({
        baseUrl: '/web/',
        origin: 'http://localhost:3111'
      })
    ).not.toHaveProperty('sentryEnvironment')
  })
})

describe('resolveBrowserShellConfig', () => {
  it("defaults the Sentry environment to 'development'", () => {
    expect(resolveBrowserShellConfig()).toMatchObject({
      sentryEnvironment: 'development'
    })
  })

  it('preserves an explicit Sentry environment', () => {
    expect(resolveBrowserShellConfig({ sentryEnvironment: 'production' })).toMatchObject({
      sentryEnvironment: 'production'
    })
  })
})
