import { describe, expect, it } from 'vitest'
import { resolveBrowserShellBootstrapConfig } from '../src/config.js'

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
      githubRedirectUri: 'https://embed.example/widget/#/auth/callback'
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
      hostToken: null
    })
  })
})
