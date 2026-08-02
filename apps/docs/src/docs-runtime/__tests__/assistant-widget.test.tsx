/**
 * What the widget hands `ChatApp` (issue #480), and what survives a route change.
 *
 * `ChatApp` itself is covered by app-browser's own suite; what cannot be covered
 * there is the docs-specific wiring — `morphable={false}`, controlled
 * minimization against the docs presentation store, and route-aware starters that
 * follow Docusaurus navigation. So `ChatApp` is captured here and its props
 * asserted, while the surrounding providers are real.
 */
import { createHash } from 'node:crypto'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useHistory } from '@docs-test/react-router-dom'
import type { ChatAppProps } from '@tinytinkerer/app-browser'

const captured = vi.hoisted(() => ({ props: null as ChatAppProps | null, mounts: 0 }))

vi.mock('@tinytinkerer/app-browser', () => ({
  ChatApp: (props: ChatAppProps) => {
    captured.props = props
    return <div data-testid="chat-app">chat</div>
  },
  // The docked-panel measurement is real geometry the stub ChatApp never renders,
  // so it is stubbed to "floating" here; the page-inset behaviour it drives has
  // its own coverage in the widget e2e.
  useDockedPanelMetrics: () => ({ ref: { current: null }, metrics: null })
}))

const load = async () => {
  const widget = await import('../assistant-widget')
  const presentation = await import('../assistant-presentation')
  const page = await import('../../docs-page')
  const stub = await import('../../test/docusaurus-use-global-data-stub')
  const { siteGlobalData } = await import('../../docs-page/__tests__/site-corpus-fixture')
  presentation.resetDocsAssistantPresentationForTests()
  stub.__setDocusaurusGlobalData('docusaurus-plugin-content-docs', 'default', siteGlobalData())
  return { ...widget, ...presentation, ...page }
}

/**
 * Serve #474's real manifest shape, so a document route actually resolves to an
 * authored document rather than to `corpus_unavailable` — the difference the
 * route-aware rule turns on.
 */
const serveCorpus = async (): Promise<void> => {
  const { SITE_DOCUMENTS } = await import('../../docs-page/__tests__/site-corpus-fixture')
  const { __setPluginData } = await import('../../test/generated-global-data-stub')
  const { resetDocumentationCorpusStoreForTests } = await import('../../docs-corpus/manifest-store')
  resetDocumentationCorpusStoreForTests()

  const manifestHash = createHash('sha256')
    .update(JSON.stringify({ schemaVersion: 1, documents: SITE_DOCUMENTS }))
    .digest('hex')
  const manifestUrl = '/docs/assets/docs-corpus/manifest.v1.abc123.json'
  __setPluginData('documentation-corpus', 'default', {
    schemaVersion: 1,
    manifestHash,
    manifestUrl
  })
  vi.stubGlobal('fetch', () =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ schemaVersion: 1, manifestHash, documents: SITE_DOCUMENTS })
    })
  )
}

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
  captured.props = null
  captured.mounts = 0
  // The corpus manifest is fetched by the #476 provider; these tests only need
  // the route resolution, so let it fail and assert the no-document behaviour
  // where that matters.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
})

const renderWidget = async (initialEntry = '/docs/architecture/') => {
  const { DocsAssistantWidget, DocsPageProvider, ...rest } = await load()
  const view = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DocsPageProvider>
        <DocsAssistantWidget />
      </DocsPageProvider>
    </MemoryRouter>
  )
  return { ...view, ...rest }
}

describe('the widget is the real ChatApp, configured for a documentation site', () => {
  it('renders it floating by default and morphable', async () => {
    await renderWidget()

    expect(screen.getByTestId('chat-app')).toBeInTheDocument()
    expect(captured.props?.mode).toBe('floating')
    // Morphing into the docked web mode is supported (issue #480 re-review,
    // finding 2): the reader gets the same dock/undock the IDE and canvas
    // shells offer, and the docs page insets around it rather than being
    // covered.
    expect(captured.props?.morphable).not.toBe(false)
  })

  it('is controlled on BOTH axes by the docs presentation store', async () => {
    // One authority. `ChatApp` persists `:mode` and `FloatingLayout` persists
    // `minimized` inside its geometry blob; letting either own half the answer
    // is what makes "is the assistant showing?" depend on which store you ask.
    const { setDocsAssistantMode } = await renderWidget()

    expect(captured.props?.mode).toBe('floating')
    expect(captured.props?.onModeChange).toBeTypeOf('function')
    expect(captured.props?.onMinimizedChange).toBeTypeOf('function')

    act(() => {
      setDocsAssistantMode('sidebar')
    })
    expect(captured.props?.mode).toBe('sidebar')
  })

  it('writes the widget"s own dock/undock back into the store', async () => {
    const { readDocsAssistantPresentation } = await renderWidget()

    act(() => {
      captured.props?.onModeChange?.('sidebar')
    })
    expect(readDocsAssistantPresentation().mode).toBe('sidebar')

    act(() => {
      captured.props?.onModeChange?.('floating')
    })
    expect(readDocsAssistantPresentation().mode).toBe('floating')
  })

  it('gives it the assistant"s own layout key, apart from the conversation store', async () => {
    const { DOCS_ASSISTANT_LAYOUT_STORAGE_KEY } = await import('../assistant-constants')
    await renderWidget()

    expect(captured.props?.storageKey).toBe(DOCS_ASSISTANT_LAYOUT_STORAGE_KEY)
  })

  it('makes the stage click-through so the documentation stays usable', async () => {
    await renderWidget()

    expect(captured.props?.stageClassName).toBe('docs-assistant-stage')
  })
})

describe('minimization is controlled by the docs presentation store', () => {
  it('passes the store"s value, not FloatingLayout"s persisted one', async () => {
    const { setDocsAssistantMinimized } = await renderWidget()

    expect(captured.props?.minimized).toBe(true)

    act(() => {
      setDocsAssistantMinimized(false)
    })
    expect(captured.props?.minimized).toBe(false)
  })

  it('writes the widget"s own minimize back into the store', async () => {
    const { readDocsAssistantPresentation } = await renderWidget()

    act(() => {
      captured.props?.onMinimizedChange?.(false)
    })
    expect(readDocsAssistantPresentation().minimized).toBe(false)

    act(() => {
      captured.props?.onMinimizedChange?.(true)
    })
    expect(readDocsAssistantPresentation().minimized).toBe(true)
  })

  it('takes focus on mount only when a reader opened it', async () => {
    const first = await renderWidget()
    // Nothing opened it: this mount is a page load.
    expect(captured.props?.focusPanelOnMount).toBe(false)
    first.unmount()

    vi.resetModules()
    const second = await load()
    second.openDocsAssistant()
    render(
      <MemoryRouter initialEntries={['/docs/architecture/']}>
        <second.DocsPageProvider>
          <second.DocsAssistantWidget />
        </second.DocsPageProvider>
      </MemoryRouter>
    )
    expect(captured.props?.focusPanelOnMount).toBe(true)
  })
})

describe('route-aware suggestions', () => {
  it('offers current-page suggestions on an authored document', async () => {
    await serveCorpus()
    const { DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS } = await import('../assistant-starters')
    await renderWidget('/docs/architecture/packages-concept/')

    await waitFor(() => {
      expect(captured.props?.starterPrompts?.[0]).toBe(
        DOCS_ASSISTANT_CURRENT_PAGE_STARTER_PROMPTS[0]
      )
    })
    // Three shown, so both current-page questions fit beside a cross-page one.
    expect(captured.props?.starterPromptCount).toBe(3)
  })

  it('offers route-neutral ones on the docs landing page"s siblings that are generated', async () => {
    await serveCorpus()
    const { DOCS_ASSISTANT_STARTER_PROMPTS } = await import('../assistant-constants')
    // A Docusaurus-generated category index: a real route, and nobody authored
    // it, so `read_current_doc` would report no current document there.
    await renderWidget('/docs/category/architecture/')

    await waitFor(() => {
      expect(captured.props?.starterPrompts).toEqual(DOCS_ASSISTANT_STARTER_PROMPTS)
    })
  })

  it('offers route-neutral suggestions only where there is no current document', async () => {
    const { DOCS_ASSISTANT_STARTER_PROMPTS } = await import('../assistant-constants')
    // `/docs/search/` is not a document route, and the corpus is unreachable
    // here anyway — both are no-document states, and neither may claim a page.
    await renderWidget('/docs/search/')

    expect(captured.props?.starterPrompts).toEqual(DOCS_ASSISTANT_STARTER_PROMPTS)
    expect(captured.props?.starterPrompts?.some((p) => /this page/i.test(p))).toBe(false)
  })

  it('updates the suggestions on navigation without remounting the chat', async () => {
    const Navigator = ({ to }: { to: string }) => {
      const history = useHistory()
      return (
        <button type="button" onClick={() => history.push(to)}>
          navigate
        </button>
      )
    }
    const { DocsAssistantWidget, DocsPageProvider } = await load()
    render(
      <MemoryRouter initialEntries={['/docs/architecture/']}>
        <DocsPageProvider>
          <Navigator to="/docs/search/" />
          <DocsAssistantWidget />
        </DocsPageProvider>
      </MemoryRouter>
    )

    const before = screen.getByTestId('chat-app')
    act(() => {
      screen.getByRole('button', { name: 'navigate' }).click()
    })

    // Same DOM node: the conversation, the composer draft and any in-flight run
    // outlive a route change because nothing about this subtree is remounted.
    expect(screen.getByTestId('chat-app')).toBe(before)
  })
})
