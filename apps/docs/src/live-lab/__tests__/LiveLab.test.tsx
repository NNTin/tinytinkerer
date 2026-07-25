import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

describe('LiveLab', () => {
  it('renders only the network notice and the BrowserOnly fallback during static rendering (no client runtime touched)', async () => {
    vi.resetModules()
    // Docusaurus's real <BrowserOnly> renders exactly this — `fallback` only,
    // never invoking `children` — when `typeof window === 'undefined'` (a static
    // build/prerender). Mirroring that exact contract here is what proves LiveLab
    // never reaches the product runtime during a static build.
    vi.doMock('@docusaurus/BrowserOnly', () => ({
      default: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>
    }))
    const clientRuntimeFactory = vi.fn()
    vi.doMock('../client-runtime', () => {
      clientRuntimeFactory()
      return { default: () => <div>should never render</div> }
    })

    const { LiveLab } = await import('../LiveLab')
    render(
      <LiveLab title="Example lab">
        <p>lab body</p>
      </LiveLab>
    )

    expect(screen.getByText(/contacts the live tinytinkerer backend/i)).toBeInTheDocument()
    expect(screen.queryByText('lab body')).not.toBeInTheDocument()
    expect(screen.queryByText('should never render')).not.toBeInTheDocument()
    // React.lazy's dynamic import() only resolves the module the first time the
    // lazy component actually renders — never triggered by the fallback path.
    expect(clientRuntimeFactory).not.toHaveBeenCalled()
  })

  it('lazy-loads and renders the client runtime once the browser boundary mounts', async () => {
    vi.resetModules()
    vi.doMock('@docusaurus/BrowserOnly', () => ({
      default: ({ children }: { children: () => ReactNode }) => <>{children()}</>
    }))
    vi.doMock('../client-runtime', () => ({
      default: ({ children }: { children: ReactNode }) => (
        <div data-testid="client-runtime">{children}</div>
      )
    }))

    const { LiveLab } = await import('../LiveLab')
    render(
      <LiveLab>
        <p>lab body</p>
      </LiveLab>
    )

    await waitFor(() => expect(screen.getByTestId('client-runtime')).toBeInTheDocument())
    expect(screen.getByText('lab body')).toBeInTheDocument()
  })
})
