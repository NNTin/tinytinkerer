import { describe, expect, it } from 'vitest'
import { resolveGitHubRedirectUri } from './runtime-config'

describe('web runtime config', () => {
  it('derives the oauth callback from the current origin when unset', () => {
    expect(resolveGitHubRedirectUri(undefined, '/', 'https://pr-42.tiny.preview.nntin.xyz')).toBe(
      'https://pr-42.tiny.preview.nntin.xyz/#/auth/callback'
    )
  })

  it('preserves an explicit redirect URI override', () => {
    expect(
      resolveGitHubRedirectUri(
        'https://tiny.nntin.xyz/#/auth/callback',
        '/',
        'https://pr-42.tiny.preview.nntin.xyz'
      )
    ).toBe('https://tiny.nntin.xyz/#/auth/callback')
  })
})
