/**
 * The Root-mounted host itself (issue #479): nothing until asked, the runtime
 * once asked, and — whatever happens — never the documentation page.
 *
 * The runtime chunk is stubbed rather than booted; that it is the ONLY static
 * importer of the product runtime is what `static-safety.test.ts` pins, and what
 * it does once mounted is `assistant-app.test.ts`'s subject. What matters here is
 * the boundary: when the chunk is fetched, and what a failure inside it reaches.
 */
import { createElement, Fragment } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clientLoads = vi.hoisted(() => ({ count: 0, shouldThrow: false }))

// No JSX anywhere in this file, hence the `.ts` extension and `createElement`:
// vitest hoists `vi.mock` factories above the imports, and a factory that
// returns a component defeats the JSX transform for the whole module.
vi.mock('../assistant-runtime-client', () => {
  clientLoads.count += 1
  return {
    default: () => {
      if (clientLoads.shouldThrow) throw new Error('runtime exploded')
      return clientElement()
    }
  }
})

beforeEach(() => {
  vi.resetModules()
  clientLoads.count = 0
  clientLoads.shouldThrow = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

const clientElement = () => createElement('p', null, 'assistant runtime')

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
    expect(clientLoads.count).toBe(0)
  })

  it('mounts the runtime once activated', async () => {
    const { requestDocsAssistantRuntime } = await renderRoot()

    act(() => {
      requestDocsAssistantRuntime()
    })

    expect(await screen.findByText('assistant runtime')).toBeInTheDocument()
    expect(clientLoads.count).toBe(1)
    expect(screen.getByText('documentation page')).toBeInTheDocument()
  })

  it('contains a failing runtime instead of blanking the documentation', async () => {
    // The error boundary logs through console.error; keep the run quiet while
    // still proving the failure was reported rather than swallowed.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    clientLoads.shouldThrow = true

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
