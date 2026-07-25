import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

describe('RichContentPlayground', () => {
  it('renders only the LabContainer loading fallback during static rendering (no client runtime touched)', async () => {
    vi.resetModules()
    // Mirrors Docusaurus's real <BrowserOnly> contract during a static
    // build/prerender: `fallback` only, `children` never invoked.
    vi.doMock('@docusaurus/BrowserOnly', () => ({
      default: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>
    }))
    const clientRuntimeFactory = vi.fn()
    vi.doMock('../client-runtime', () => {
      clientRuntimeFactory()
      return { default: () => <div>should never render</div> }
    })

    const { RichContentPlayground } = await import('../RichContentPlayground')
    render(<RichContentPlayground />)

    expect(screen.getByRole('status')).toHaveTextContent(/loading/i)
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
      default: ({ title }: { title: string }) => <div data-testid="client-runtime">{title}</div>
    }))

    const { RichContentPlayground } = await import('../RichContentPlayground')
    render(<RichContentPlayground title="Try it" />)

    await waitFor(() => expect(screen.getByTestId('client-runtime')).toBeInTheDocument())
    expect(screen.getByText('Try it')).toBeInTheDocument()
  })
})
