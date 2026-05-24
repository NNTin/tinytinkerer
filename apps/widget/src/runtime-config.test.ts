import { describe, expect, it } from 'vitest'
import { resolveWidgetGitHubRedirectUri } from './runtime-config'

describe('widget runtime config', () => {
  it('derives the oauth callback from the current origin when no override is provided', () => {
    expect(
      resolveWidgetGitHubRedirectUri(
        { githubClientId: 'client-id' },
        'client-id',
        '/widget/',
        'https://pr-42.tiny.preview.nntin.xyz'
      )
    ).toBe('https://pr-42.tiny.preview.nntin.xyz/widget/#/auth/callback')
  })

  it('prefers the host-provided redirect URI', () => {
    expect(
      resolveWidgetGitHubRedirectUri(
        {
          githubClientId: 'client-id',
          githubRedirectUri: 'https://embed.example/widget/#/auth/callback'
        },
        'client-id',
        '/widget/',
        'https://pr-42.tiny.preview.nntin.xyz'
      )
    ).toBe('https://embed.example/widget/#/auth/callback')
  })

  it('returns undefined when oauth is not configured', () => {
    expect(
      resolveWidgetGitHubRedirectUri({}, undefined, '/widget/', 'https://example.com')
    ).toBeUndefined()
  })
})
