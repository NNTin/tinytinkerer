import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@docusaurus/useDocusaurusContext', () => ({
  default: () => ({
    siteConfig: {
      customFields: {
        tinyEdgeBaseUrl: 'https://edge.example',
        tinyGithubClientId: 'client-123',
        tinySentryDsn: undefined,
        tinySentryEnvironment: undefined,
        tinyProductBaseUrl: '/pr-7/'
      }
    }
  })
}))

describe('useDocsLabRuntimeConfig', () => {
  it('reads the edge/GitHub-OAuth config docusaurus.config.ts baked into the page', async () => {
    const { useDocsLabRuntimeConfig } = await import('../runtime-config')
    const { result } = renderHook(() => useDocsLabRuntimeConfig())
    expect(result.current).toEqual({
      edgeBaseUrl: 'https://edge.example',
      githubClientId: 'client-123',
      sentryDsn: undefined,
      sentryEnvironment: undefined,
      productBaseUrl: '/pr-7/'
    })
  })

  it('falls back safely when customFields is missing entirely', async () => {
    vi.resetModules()
    vi.doMock('@docusaurus/useDocusaurusContext', () => ({
      default: () => ({ siteConfig: {} })
    }))
    const { useDocsLabRuntimeConfig } = await import('../runtime-config')
    const { result } = renderHook(() => useDocsLabRuntimeConfig())
    expect(result.current.edgeBaseUrl).toBe('')
    expect(result.current.productBaseUrl).toBe('/')
  })
})
