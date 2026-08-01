/**
 * The Root-mounted host (issue #479): nothing until asked, the runtime once
 * asked, a retry that genuinely re-imports, and — whatever happens — never the
 * documentation page.
 *
 * The runtime chunk is stubbed at the LOADER (issue #479 review, finding 3). A
 * test that mocked the client module could only prove that an enum changed; what
 * has to be proved is that a second activation calls `import()` again, because
 * `React.lazy` memoises its rejection and the first implementation rethrew it
 * forever while the status said "try again".
 */
import { createElement, Fragment } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loader = vi.hoisted(() => ({ calls: 0, failUntil: 0 }))

// No JSX anywhere in this file, hence the `.ts` extension and `createElement`:
// vitest hoists `vi.mock` factories above the imports, and a factory that
// returns a component defeats the JSX transform for the whole module.
vi.mock('../assistant-runtime-loader', () => ({
  importAssistantRuntimeClient: () => {
    loader.calls += 1
    return loader.calls <= loader.failUntil
      ? Promise.reject(new Error('chunk load failed'))
      : Promise.resolve({ default: () => createElement('p', null, 'assistant runtime') })
  }
}))

beforeEach(() => {
  vi.resetModules()
  loader.calls = 0
  loader.failUntil = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

// Stands in for the documentation Docusaurus renders beside the host — the thing
// that must survive everything below.
const Page = () => createElement('p', null, 'documentation page')

const renderRoot = async () => {
  const { DocsAssistantRuntimeHost } = await import('../AssistantRuntimeHost')
  const activation = await import('../assistant-activation')
  render(
    createElement(Fragment, null, createElement(Page), createElement(DocsAssistantRuntimeHost))
  )
  return activation
}

describe('DocsAssistantRuntimeHost', () => {
  it('renders nothing and fetches no runtime on a documentation page', async () => {
    await renderRoot()

    expect(screen.getByText('documentation page')).toBeInTheDocument()
    expect(screen.queryByText('assistant runtime')).not.toBeInTheDocument()
    // The whole point of the lazy boundary: opening a page costs no chunk.
    expect(loader.calls).toBe(0)
  })

  it('mounts the runtime once activated', async () => {
    const { requestDocsAssistantRuntime } = await renderRoot()

    act(() => {
      requestDocsAssistantRuntime()
    })

    expect(await screen.findByText('assistant runtime')).toBeInTheDocument()
    expect(loader.calls).toBe(1)
    expect(screen.getByText('documentation page')).toBeInTheDocument()
  })

  it('re-imports on retry after a failed chunk load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    loader.failUntil = 1

    const { requestDocsAssistantRuntime, readDocsAssistantRuntimeStatus } = await renderRoot()

    act(() => {
      requestDocsAssistantRuntime()
    })
    await waitFor(() => {
      expect(readDocsAssistantRuntimeStatus()).toBe('error')
    })
    expect(loader.calls).toBe(1)
    expect(screen.queryByText('assistant runtime')).not.toBeInTheDocument()
    expect(screen.getByText('documentation page')).toBeInTheDocument()

    // The retry. This is what a memoised `lazy` payload could not do: the loader
    // has to run a SECOND time, and the runtime has to actually mount.
    act(() => {
      requestDocsAssistantRuntime()
    })
    expect(await screen.findByText('assistant runtime')).toBeInTheDocument()
    expect(loader.calls).toBe(2)
    expect(consoleError).toHaveBeenCalled()
  })

  it('contains a failing runtime instead of blanking the documentation', async () => {
    // The error boundary logs through console.error; keep the run quiet while
    // still proving the failure was reported rather than swallowed.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    loader.failUntil = Number.POSITIVE_INFINITY

    const { requestDocsAssistantRuntime, readDocsAssistantRuntimeStatus } = await renderRoot()
    act(() => {
      requestDocsAssistantRuntime()
    })

    await waitFor(() => {
      expect(readDocsAssistantRuntimeStatus()).toBe('error')
    })
    // The documentation is still there. A provider wrapping `children` — the
    // rejected alternative — could not have promised this.
    expect(screen.getByText('documentation page')).toBeInTheDocument()
    expect(screen.queryByText('assistant runtime')).not.toBeInTheDocument()
    expect(consoleError).toHaveBeenCalled()
  })
})
