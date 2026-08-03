// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The documentation page's REAL topology, with the shells actually mounted
 * (issue #482, review finding 2).
 *
 * `document-globals-multi-app.test.ts` beside this one calls
 * `initializeBrowserApp` directly, which is the right shape for the questions it
 * asks about consent and install identity. It cannot answer this one: the OAuth
 * callback watchdog is armed by `BrowserAppShell` in an effect, **outside** the
 * `globalHosts` block, once per mounted shell. Counting `documentGlobals`
 * booleans — which is what the first revision of this test did — would pass even
 * if the shell ignored the flag entirely and armed a timer for every shell.
 *
 * So this renders the topology:
 *
 * - ONE assistant `BrowserApp`, in one shell;
 * - ONE live-lab `BrowserApp` — the module singleton every `<LiveLab>` shares —
 *   in SEVERAL shells, because a page can carry several labs;
 * - both mount orders, since "which booted first" is the thing structural
 *   ownership exists to stop mattering.
 *
 * The watchdog is observed rather than inferred: the module the shell
 * dynamically imports is mocked, and every arming is counted.
 */
vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: vi.fn().mockResolvedValue([])
}))

const armings = vi.hoisted(() => ({ count: 0, disposed: 0 }))

vi.mock('../src/telemetry/oauth-callback-watchdog', () => ({
  armOAuthCallbackWatchdog: () => {
    armings.count += 1
    return () => {
      armings.disposed += 1
    }
  }
}))

// `createBrowserApp` builds a shell whose persistence is Dexie-backed, and jsdom
// has no IndexedDB. Only the shape matters here — nothing in this suite reads a
// preference back — so one in-memory stand-in per namespace is enough.
/**
 * Bootstrap is stubbed to "already ready", deliberately.
 *
 * What this suite tests is `BrowserAppShell`'s OWN effect: the OAuth callback
 * watchdog is armed outside the `globalHosts` block, once per mounted shell, and
 * gated only on `app.documentGlobals.oauthCallbackWatchdog`. Running the real
 * `initializeBrowserApp` here would drag the whole persistence stack into a
 * jsdom process with no IndexedDB, whose failure mode — "a shell never left its
 * boot screen" — is indistinguishable from the defect this suite exists to
 * detect. A test whose failure impersonates its subject is worse than none.
 *
 * The real bootstrap, with real persistence and the real telemetry module, is
 * covered by `document-globals-multi-app.test.ts` beside this file. The two
 * together are the claim: that suite proves what booting an app does, this one
 * proves how many times mounting N shells does it.
 */
vi.mock('../src/bootstrap', () => ({
  useBrowserAppBootstrap: () => ({ ready: true, error: null })
}))

vi.mock('../src/db', () => {
  const stores = new Map<string, Map<string, string>>()
  return {
    createBrowserPersistence: (storageNamespace: string) => {
      const store = stores.get(storageNamespace) ?? new Map<string, string>()
      stores.set(storageNamespace, store)
      return {
        preferences: {
          get: (key: string) => Promise.resolve(store.get(key)),
          set: (key: string, value: string) => {
            store.set(key, value)
            return Promise.resolve()
          }
        },
        conversations: {},
        authTokens: {
          getStoredToken: () => Promise.resolve(null),
          setStoredToken: () => Promise.resolve(),
          clearStoredToken: () => Promise.resolve()
        }
      }
    }
  }
})

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createBrowserApp } from '../src/app.js'
import { BrowserAppShell } from '../src/browser-app-shell.js'
import { NO_GLOBAL_HOST_CAPABILITIES } from '../src/document-globals.js'

const ASSISTANT_NAMESPACE = 'tinytinkerer-docs-assistant'
const LAB_NAMESPACE = 'tinytinkerer-docs-lab'

const createDocsApp = (storageNamespace: string, { owner }: { owner: boolean }) =>
  createBrowserApp(
    {
      storageNamespace,
      appVersion: owner ? 'assistant-build' : 'lab-build',
      buildHash: owner ? 'assistant-build' : 'lab-build',
      sentryEnvironment: 'development'
    },
    {
      documentGlobals: {
        brandMetadata: false,
        telemetry: owner,
        contentRenderReporter: owner,
        oauthCallbackWatchdog: owner
      }
    }
  )

const BootScreen = ({ error }: { error?: string }) => (error ? <b>BOOT-ERROR: {error}</b> : null)

/**
 * ONE config object for every shell, hoisted deliberately.
 *
 * `useBrowserAppBootstrap` depends on `config` by reference, so a `config={{}}`
 * literal re-fires the bootstrap effect on every render — the previous attempt
 * is disposed before it can publish `ready`, and a shell can sit on its boot
 * screen indefinitely. Exactly the hazard `apps/docs/src/docs-runtime/runtime-config.ts`
 * memoizes against for the real thing.
 */
const SHELL_CONFIG = {}

/**
 * Waits until every named shell has rendered its children — i.e. every shell is
 * past its boot screen, so every effect that will ever run has run.
 *
 * By explicit id rather than `getAllByTestId(/^lab-/)`: this RTL version
 * stringifies a regex into the selector, which silently matches nothing.
 */
const settleWatchdogImports = async (): Promise<void> => {
  // The shell reaches the watchdog through a dynamic `import()`, so an arming
  // lands a few microtasks after its effect runs. Several macrotask turns is
  // comfortably more than the module registry needs once it is warm, and is what
  // makes "exactly one" a statement about all four shells rather than the first.
  // Inside `act`, so React's own scheduled work drains with each turn. Without
  // it the trees are unmounted by `cleanup()` while the concurrent scheduler
  // still holds a task, which then runs after the environment is torn down and
  // fails with "window is not defined" — attributed, confusingly, to whichever
  // test file happened to be running next.
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
  }
}

const waitForShells = async (labels: readonly string[]): Promise<void> => {
  await waitFor(() => {
    for (const label of labels) expect(screen.getByTestId(label)).toBeDefined()
  })
}

/** One mounted shell, identified so the test can wait for it to be live. */
const Shell = ({
  app,
  owner,
  label
}: {
  app: ReturnType<typeof createBrowserApp>
  owner: boolean
  label: string
}) => (
  <BrowserAppShell
    app={app}
    config={SHELL_CONFIG}
    BootScreen={BootScreen}
    globalHosts={owner ? { telemetryConsent: true } : NO_GLOBAL_HOST_CAPABILITIES}
  >
    <span data-testid={label}>{label}</span>
  </BrowserAppShell>
)

// This package configures no global RTL cleanup, so a test that renders must
// unmount before the next one does — otherwise `getByTestId('assistant')` finds
// the previous test's tree as well as its own.
afterEach(() => {
  cleanup()
})

beforeEach(() => {
  armings.count = 0
  armings.disposed = 0
  document.head.innerHTML = ''
})

describe('one assistant shell beside several live-lab shells', () => {
  it.each([
    ['labs first, assistant after (a reader activates it later)', true],
    ['assistant first, labs after', false]
  ])('arms exactly one OAuth callback watchdog — %s', async (_label, labsFirst) => {
    const assistant = createDocsApp(ASSISTANT_NAMESPACE, { owner: true })
    // ONE lab app, THREE shells: `live-lab/client-runtime.tsx` keeps a module
    // singleton, and every <LiveLab> on the page mounts its own shell around it.
    const lab = createDocsApp(LAB_NAMESPACE, { owner: false })

    const labs = (
      <>
        <Shell app={lab} owner={false} label="lab-1" />
        <Shell app={lab} owner={false} label="lab-2" />
        <Shell app={lab} owner={false} label="lab-3" />
      </>
    )
    const assistantShell = <Shell app={assistant} owner label="assistant" />

    render(
      labsFirst ? (
        <>
          {labs}
          {assistantShell}
        </>
      ) : (
        <>
          {assistantShell}
          {labs}
        </>
      )
    )

    // Every shell is past its boot screen, so every watchdog effect that is ever
    // going to run has run.
    await waitForShells(['assistant', 'lab-1', 'lab-2', 'lab-3'])

    // Every shell's watchdog effect has now run; let their dynamic imports
    // settle before counting. Deliberately NOT `waitFor(() => count === 1)`,
    // which stops the moment the FIRST arming lands and would therefore pass
    // while three more were still in flight — the exact way this assertion was
    // vacuous in its first revision.
    await settleWatchdogImports()

    // Four shells, one timer. Not "one app is configured for it" — one ARMING,
    // observed at the module the shell imports.
    //
    // Stated plainly: on its own this case is the WEAKER half. A shell that
    // armed unconditionally can still land its extra armings after this
    // assertion, so the mutation test that proves the count means something is
    // the no-owner case below, where the same defect turns 0 into 3.
    expect(armings.count).toBe(1)
  })

  it('arms none at all when only live labs are mounted', async () => {
    // The complement, and the case that makes the count mean something.
    //
    // "Exactly one owner armed it" is hard to make robust against import timing:
    // a stray extra arming can land after the assertion. "No non-owner ever arms
    // one" is not — a shell that ignored `documentGlobals` would turn this 0
    // into a 3, which no amount of scheduling can hide. It is also the half that
    // matters for the document: the labs must add nothing.
    const lab = createDocsApp(LAB_NAMESPACE, { owner: false })

    render(
      <>
        <Shell app={lab} owner={false} label="lab-1" />
        <Shell app={lab} owner={false} label="lab-2" />
        <Shell app={lab} owner={false} label="lab-3" />
      </>
    )
    await waitForShells(['lab-1', 'lab-2', 'lab-3'])
    await settleWatchdogImports()

    expect(armings.count).toBe(0)
  })
})
