/**
 * The launcher, the overlay root, and the handoff between them (issue #480).
 *
 * Everything here is the LIGHT half of the assistant — the half that ships on
 * every documentation page. The runtime is stubbed at the loader, so these tests
 * cover what a reader sees before (and during, and after a failed) activation
 * without booting a `BrowserApp`.
 *
 * The property that shapes the whole design: `app-browser`'s own minimized
 * launcher lives inside the chunk that has not been downloaded yet, so there has
 * to be a second one — and therefore a rule that only ever one of them is
 * interactive.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  loads: 0,
  fail: false,
  mounted: false
}))

// Stands in for the whole runtime chunk. Publishing `ready` from its effect is
// what the real client does from inside `BrowserAppShell` — see
// assistant-lifecycle.test.tsx, which drives the genuine one.
vi.mock('../assistant-runtime-loader', () => ({
  importAssistantRuntimeClient: async () => {
    runtime.loads += 1
    if (runtime.fail) {
      throw new Error('chunk unavailable')
    }
    const { useEffect } = await import('react')
    const { publishDocsAssistantRuntimeStatus } = await import('../assistant-activation')
    return {
      default: () => {
        useEffect(() => {
          runtime.mounted = true
          publishDocsAssistantRuntimeStatus('ready')
        }, [])
        return <div data-testid="assistant-panel">panel</div>
      }
    }
  }
}))

const load = async () => {
  const host = await import('../AssistantRuntimeHost')
  const presentation = await import('../assistant-presentation')
  const activation = await import('../assistant-activation')
  const overlays = await import('../host-overlays')
  presentation.resetDocsAssistantPresentationForTests()
  overlays.resetDocsHostOverlaysForTests()
  return { ...host, ...presentation, ...activation, ...overlays }
}

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  runtime.loads = 0
  runtime.fail = false
  runtime.mounted = false
  // console.error is expected on the failure paths; keep the output readable.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const launcher = () => screen.getByRole('button', { name: /documentation assistant/i })
const root = (): HTMLElement => {
  const element = document.querySelector('.docs-assistant-root')
  if (!element) throw new Error('the assistant overlay root was not rendered')
  return element as HTMLElement
}

describe('a cold documentation page', () => {
  it('shows the launcher and downloads no runtime', async () => {
    const { DocsAssistantRuntimeHost } = await load()
    render(<DocsAssistantRuntimeHost />)

    expect(launcher()).toBeInTheDocument()
    expect(launcher()).toHaveAttribute('aria-label', 'Open the documentation assistant')
    // The whole point of the lazy boundary: nothing is fetched until asked.
    expect(runtime.loads).toBe(0)
    expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument()
  })

  it('adds no page height — the root is fixed and out of flow', async () => {
    const { DocsAssistantRuntimeHost } = await load()
    render(<DocsAssistantRuntimeHost />)

    // Asserted as a contract on the element the stylesheet targets: the CSS
    // itself is not loaded in jsdom, and the class is what carries the rule.
    expect(root()).toHaveClass('docs-assistant-root')
    expect(root().getAttribute('data-host-overlay')).toBe('false')
  })
})

describe('the handoff', () => {
  it('never shows two interactive launchers', async () => {
    const { DocsAssistantRuntimeHost } = await load()
    render(<DocsAssistantRuntimeHost />)

    await userEvent.click(launcher())

    await waitFor(() => {
      expect(screen.getByTestId('assistant-panel')).toBeInTheDocument()
    })
    // At `ready` the light launcher is gone entirely, and ChatApp's own takes
    // over inside the panel. A second one that opened nothing would be
    // indistinguishable to a reader.
    expect(screen.queryByRole('button', { name: /documentation assistant/i })).toBeNull()
  })

  it('reports itself busy while the chunk loads, without leaving the tab order', async () => {
    const { DocsAssistantRuntimeHost, requestDocsAssistantRuntime } = await load()
    render(<DocsAssistantRuntimeHost />)

    act(() => {
      requestDocsAssistantRuntime()
    })

    // `aria-busy`, not `disabled`: a disabled button stops being focusable and
    // announced, so a keyboard reader who pressed it would lose it mid-flow.
    expect(launcher()).toHaveAttribute('aria-busy', 'true')
    expect(launcher()).not.toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Starting the documentation assistant…')
  })
})

describe('a failed start', () => {
  it('offers a retry that genuinely re-imports, and returns focus to it', async () => {
    runtime.fail = true
    const { DocsAssistantRuntimeHost } = await load()
    render(<DocsAssistantRuntimeHost />)

    await userEvent.click(launcher())

    await waitFor(() => {
      expect(launcher()).toHaveAttribute(
        'aria-label',
        'The documentation assistant failed to start. Try again'
      )
    })
    expect(runtime.loads).toBe(1)
    // The reader pressed this button and the panel never arrived; focus has to
    // come back to the control that can try again.
    expect(launcher()).toHaveFocus()

    runtime.fail = false
    await userEvent.click(launcher())

    await waitFor(() => {
      expect(screen.getByTestId('assistant-panel')).toBeInTheDocument()
    })
    // The retry that matters is the loader running a second time — not an enum
    // changing back to `starting`.
    expect(runtime.loads).toBe(2)
  })
})

describe('a returning reader', () => {
  it('gets the panel back when they left it open, runtime download included', async () => {
    const first = await load()
    render(<first.DocsAssistantRuntimeHost />)
    await userEvent.click(launcher())
    await waitFor(() => {
      expect(screen.getByTestId('assistant-panel')).toBeInTheDocument()
    })

    // A fresh module graph is what a reload looks like from here.
    vi.resetModules()
    runtime.loads = 0
    const reloaded = await import('../AssistantRuntimeHost')
    render(<reloaded.DocsAssistantRuntimeHost />)

    await waitFor(() => {
      expect(screen.getByTestId('assistant-panel')).toBeInTheDocument()
    })
    expect(runtime.loads).toBe(1)
  })

  it('gets only the launcher when they left it minimized, and no runtime at all', async () => {
    const first = await load()
    render(<first.DocsAssistantRuntimeHost />)
    await userEvent.click(launcher())
    await waitFor(() => {
      expect(screen.getByTestId('assistant-panel')).toBeInTheDocument()
    })
    act(() => {
      first.setDocsAssistantMinimized(true)
    })

    vi.resetModules()
    runtime.loads = 0
    const reloaded = await import('../AssistantRuntimeHost')
    render(<reloaded.DocsAssistantRuntimeHost />)

    expect(launcher()).toBeInTheDocument()
    // The common case, and the one the cold-load budget is about.
    expect(runtime.loads).toBe(0)
  })
})

describe('while a host overlay owns the viewport', () => {
  it('hides completely without unmounting or changing the persisted state', async () => {
    const loaded = await load()
    render(<loaded.DocsAssistantRuntimeHost />)
    await userEvent.click(launcher())
    await waitFor(() => {
      expect(screen.getByTestId('assistant-panel')).toBeInTheDocument()
    })

    act(() => {
      loaded.setDocsHostOverlay('lab-fullscreen:probe', true)
    })

    // `inert` takes it out of the pointer, the tab order and the accessibility
    // tree in one attribute; the stylesheet hides it visually off the same flag.
    expect(root()).toHaveAttribute('data-host-overlay', 'true')
    expect(root()).toHaveAttribute('inert')
    // Still mounted: the conversation, the composer draft and any in-flight run
    // are exactly where the reader left them.
    expect(screen.getByTestId('assistant-panel')).toBeInTheDocument()
    expect(loaded.readDocsAssistantPresentation().minimized).toBe(false)

    act(() => {
      loaded.setDocsHostOverlay('lab-fullscreen:probe', false)
    })
    expect(root()).not.toHaveAttribute('inert')
    expect(loaded.readDocsAssistantPresentation().minimized).toBe(false)
  })
})
