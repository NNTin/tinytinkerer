import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useResolveUpstreamUrl } from '../upstream-url'

describe('useResolveUpstreamUrl', () => {
  it('resolves an upstream asset path to an ABSOLUTE URL under the site base', () => {
    // Backed by the test-only @docusaurus/useBaseUrl stub (vitest.config.ts),
    // which prefixes with '/docs/' the same way the real hook would resolve
    // 'upstream/' against the site's baseUrl (see docusaurus.config.ts's
    // pixelAgentsUpstreamDir static directory).
    const { result } = renderHook(() => useResolveUpstreamUrl())
    const resolved = result.current('tinytinkerer-bootstrap.json')

    expect(resolved).toBe(`${window.location.origin}/docs/upstream/tinytinkerer-bootstrap.json`)
  })
})
