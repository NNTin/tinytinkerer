/**
 * The activation status tracks the real session lifecycle (issue #479 review,
 * finding 1).
 *
 * `ensureDocsAssistantApp()` only CONSTRUCTS the app; `BrowserAppShell` then runs
 * `initializeBrowserApp` — auth, settings, telemetry — and renders its boot
 * screen instead of its children until that resolves. Publishing `ready` off the
 * construction meant a bootstrap failure left #480 looking at a `ready` assistant
 * with no provider mounted and `activate()` a no-op from `ready`: no surface, and
 * no way back.
 *
 * So this drives the REAL `BrowserAppShell` (mocking it would assume away the
 * lifecycle under test) with a real `BrowserApp` whose auth hydration is made to
 * reject, and asserts the transitions and what is mounted at each.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from '@docs-test/react-router-dom'
import { createBrowserApp, type BrowserApp } from '@tinytinkerer/app-browser'

import { siteGlobalData } from '../../docs-page/__tests__/site-corpus-fixture'

vi.mock('@tinytinkerer/app-browser/styles.css', () => ({}))

const bootstrap = vi.hoisted(() => ({ failures: 0 }))
const ensureDocsAssistantApp = vi.hoisted(() => vi.fn())

vi.mock('../assistant-app', () => ({ ensureDocsAssistantApp }))

const buildApp = (): { app: BrowserApp; config: Record<string, unknown> } => {
  const app = createBrowserApp(
    { storageNamespace: 'tinytinkerer-docs-assistant-test' },
    {
      documentGlobals: {
        brandMetadata: false,
        telemetry: false,
        contentRenderReporter: false,
        oauthCallbackWatchdog: false
      }
    }
  )
  // The document-global hosts this shell owns are REAL (the consent gate reads
  // `preferences` the moment settings hydrate), so the shell needs a working
  // preferences store — Dexie's needs an IndexedDB this environment lacks.
  const preferences = new Map<string, string>()
  Object.assign(app.shell, {
    preferences: {
      get: (key: string) => Promise.resolve(preferences.get(key)),
      set: (key: string, value: string) => {
        preferences.set(key, value)
        return Promise.resolve()
      }
    }
  })
  // Hydration is what `initializeBrowserApp` awaits, and it reads through Dexie
  // — which needs an IndexedDB this environment does not have. Both stores'
  // hydration is therefore stubbed, and the auth one is where the failure is
  // injected: a rejection there is a genuine bootstrap rejection travelling the
  // real path through `initializeBrowserApp` and `BrowserAppShell`, not a
  // simulated one.
  app.stores.auth.setState({
    initialize: () => {
      if (bootstrap.failures > 0) {
        bootstrap.failures -= 1
        return Promise.reject(new Error('auth hydration failed'))
      }
      return Promise.resolve()
    }
  })
  // Discovery-time reconciliation is fire-and-forget inside `initializeBrowserApp`
  // and persists through Dexie; stubbed for the same reason as hydration.
  app.stores.settings.setState({
    initialize: () => Promise.resolve(),
    reconcilePluginTools: () => Promise.resolve()
  })
  return { app, config: {} }
}

beforeEach(() => {
  vi.resetModules()
  bootstrap.failures = 0
  ensureDocsAssistantApp.mockReset()
  ensureDocsAssistantApp.mockImplementation(() => Promise.resolve(buildApp()))
  // The corpus manifest is left unreachable: the assistant's lifecycle is what
  // this file is about, and a route with no resolved document is a perfectly
  // ordinary one for it.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
})

const renderClient = async () => {
  const { default: AssistantRuntimeClient } = await import('../assistant-runtime-client')
  const activation = await import('../assistant-activation')
  const surface = await import('../assistant-surface')
  surface.registerDocsAssistantSurface(
    'probe',
    () => <p data-testid="surface">assistant surface</p>,
    { placement: 'inline' }
  )
  // Inside the router and the #476 provider, because that is where @theme/Root
  // puts this tree: importing the runtime client registers #480's floating
  // widget, which reads the page context to pick its route-aware starters.
  // Rendering it bare would be a situation the site cannot produce, and the
  // widget would (correctly) throw about a missing provider.
  //
  // Imported HERE, not at the top of the file: `vi.resetModules()` gives each
  // test a fresh module graph, and a statically imported provider would carry
  // the previous graph's React context object — a different context from the one
  // the freshly imported widget reads, so the widget would see no provider at
  // all while one was plainly rendered above it.
  const { DocsPageProvider } = await import('../../docs-page')
  // Seeded through the fresh graph's stub for the same reason.
  const { __setDocusaurusGlobalData } = await import('../../test/docusaurus-use-global-data-stub')
  __setDocusaurusGlobalData('docusaurus-plugin-content-docs', 'default', siteGlobalData())
  const view = render(
    <MemoryRouter initialEntries={['/docs/architecture/']}>
      <DocsPageProvider>
        <AssistantRuntimeClient />
      </DocsPageProvider>
    </MemoryRouter>
  )
  return { ...activation, ...view }
}

describe('assistant runtime lifecycle', () => {
  it('publishes ready only once the shell has bootstrapped the session', async () => {
    const { requestDocsAssistantRuntime, readDocsAssistantRuntimeStatus } =
      await import('../assistant-activation')
    act(() => {
      requestDocsAssistantRuntime()
    })
    expect(readDocsAssistantRuntimeStatus()).toBe('starting')

    const { readDocsAssistantRuntimeStatus: read } = await renderClient()

    // The surface exists only inside the bootstrapped shell, so its arrival and
    // `ready` must coincide — that is the property the old code broke.
    expect(await screen.findByTestId('surface')).toBeInTheDocument()
    await waitFor(() => {
      expect(read()).toBe('ready')
    })
  })

  it('reports a bootstrap failure as error, with no surface mounted', async () => {
    bootstrap.failures = 1
    const { requestDocsAssistantRuntime } = await import('../assistant-activation')
    act(() => {
      requestDocsAssistantRuntime()
    })

    const { readDocsAssistantRuntimeStatus } = await renderClient()

    await waitFor(() => {
      expect(readDocsAssistantRuntimeStatus()).toBe('error')
    })
    // Not `ready` with nothing behind it: the shell is still showing its boot
    // screen, which renders nothing, so there is no assistant surface at all.
    expect(screen.queryByTestId('surface')).not.toBeInTheDocument()
  })

  it('reaches ready on a retry after a failed bootstrap', async () => {
    bootstrap.failures = 1
    const { requestDocsAssistantRuntime } = await import('../assistant-activation')
    act(() => {
      requestDocsAssistantRuntime()
    })

    const failed = await renderClient()
    await waitFor(() => {
      expect(failed.readDocsAssistantRuntimeStatus()).toBe('error')
    })
    failed.unmount()

    // `activate()` from `error` — the same call #480's launcher would make.
    act(() => {
      requestDocsAssistantRuntime()
    })
    expect(failed.readDocsAssistantRuntimeStatus()).toBe('starting')

    const retried = await renderClient()
    expect(await screen.findByTestId('surface')).toBeInTheDocument()
    await waitFor(() => {
      expect(retried.readDocsAssistantRuntimeStatus()).toBe('ready')
    })
  })

  it('keeps a failing surface out of the documentation and reports it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { requestDocsAssistantRuntime, readDocsAssistantRuntimeStatus } =
      await import('../assistant-activation')
    const { registerDocsAssistantSurface } = await import('../assistant-surface')
    act(() => {
      requestDocsAssistantRuntime()
    })

    const { default: AssistantRuntimeClient } = await import('../assistant-runtime-client')
    registerDocsAssistantSurface(
      'exploding',
      () => {
        throw new Error('surface exploded')
      },
      { placement: 'inline' }
    )
    render(<AssistantRuntimeClient />)

    await waitFor(() => {
      expect(readDocsAssistantRuntimeStatus()).toBe('error')
    })
    // The assistant's own boundary catches it first, so `AppErrorBoundary`'s
    // full-app "Something went wrong / Reload page" panel never renders at the
    // root of a documentation page.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Reload page/i)).not.toBeInTheDocument()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
