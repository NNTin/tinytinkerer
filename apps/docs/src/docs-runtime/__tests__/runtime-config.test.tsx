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

describe('useDocsRuntimeConfig', () => {
  it('reads the edge/GitHub-OAuth config docusaurus.config.ts baked into the page', async () => {
    const { useDocsRuntimeConfig } = await import('../runtime-config')
    const { result } = renderHook(() => useDocsRuntimeConfig())
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
    const { useDocsRuntimeConfig } = await import('../runtime-config')
    const { result } = renderHook(() => useDocsRuntimeConfig())
    expect(result.current.edgeBaseUrl).toBe('')
    expect(result.current.productBaseUrl).toBe('/')
  })
})

// Issue #481's rollback switch, as the page actually reads it.
describe('useDocsAssistantEnabled', () => {
  it('is on for a page built without the flag armed', async () => {
    vi.resetModules()
    vi.doMock('@docusaurus/useDocusaurusContext', () => ({
      default: () => ({ siteConfig: { customFields: { tinyProductBaseUrl: '/' } } })
    }))
    const { useDocsAssistantEnabled } = await import('../runtime-config')
    // Absent means enabled, matching resolveDocsAssistantEnabled: a page served
    // without custom fields is a misconfiguration, and only somebody
    // deliberately arming the switch may remove a shipped feature.
    expect(renderHook(() => useDocsAssistantEnabled()).result.current).toBe(true)
  })

  it('is off for a deployment built with the switch armed', async () => {
    vi.resetModules()
    vi.doMock('@docusaurus/useDocusaurusContext', () => ({
      default: () => ({ siteConfig: { customFields: { tinyDocsAssistantEnabled: false } } })
    }))
    const { useDocsAssistantEnabled } = await import('../runtime-config')
    expect(renderHook(() => useDocsAssistantEnabled()).result.current).toBe(false)
  })
})
