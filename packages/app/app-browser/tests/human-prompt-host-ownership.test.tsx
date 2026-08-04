// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

/**
 * One human-prompt modal per `BrowserApp`, however many shells it has, and none
 * at all for an app that cannot prompt (issue #489 review, findings 1 and 2).
 *
 * Two separate claims, deliberately in one suite because they are two halves of
 * a single capability:
 *
 * - an app declaring `humanInput: false` gets no queue, so its runtime offers no
 *   `requestHumanInput` and its shells mount no renderer. Those cannot disagree,
 *   because there is only one value;
 * - an app that CAN prompt, mounted by several shells (every `<LiveLab>` on a
 *   documentation page mounts its own over the one shared lab app), draws its
 *   modal exactly once. Two would mean two full-viewport overlays and two
 *   `aria-modal` dialogs competing in the shared focus stack.
 *
 * The composer dock is deliberately NOT elected this way — several surfaces of
 * one session may each show its question — which
 * `human-prompt-session-routing.test.tsx` asserts directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/db', () => ({
  createBrowserPersistence: () => ({
    preferences: { get: () => Promise.resolve(undefined), set: () => Promise.resolve() },
    conversations: {},
    authTokens: {
      getStoredToken: () => Promise.resolve(null),
      setStoredToken: () => Promise.resolve(),
      clearStoredToken: () => Promise.resolve()
    }
  })
}))

// Bootstrap is stubbed to "already ready" for the same reason
// `document-globals-multi-shell.test.tsx` does it: the real one needs IndexedDB,
// and its failure mode — a shell that never leaves its boot screen — is
// indistinguishable from the defect this suite looks for.
vi.mock('../src/bootstrap', () => ({
  useBrowserAppBootstrap: () => ({ ready: true, error: null })
}))

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { HumanPromptView } from '@tinytinkerer/contracts'
import { createBrowserApp, type BrowserApp } from '../src/app.js'
import { BrowserAppShell } from '../src/browser-app-shell.js'
import { NO_GLOBAL_HOST_CAPABILITIES } from '../src/document-globals.js'
import { noPlugins } from './plugin-catalogue-fixture'

const SHELL_CONFIG = {}
const BootScreen = () => null

const view: HumanPromptView = {
  role: 'dialog',
  ariaLabel: 'Assistant question',
  title: 'Pick one',
  actions: [{ id: 'ok', label: 'OK' }],
  dismissLabel: 'Dismiss'
}

/**
 * Waits for exactly `count` modals.
 *
 * The generous timeout is not flake-padding: `BrowserAppShell` mounts the modal
 * through `React.lazy`, so a real dynamic import has to resolve before anything
 * can be in the document, and under a loaded full-suite run that comfortably
 * exceeds testing-library's 1s default. Asserting the COUNT inside the wait also
 * means a duplicate-modal regression reports "expected 1, received 3" rather than
 * the generic multiple-match error `findByRole` would raise.
 */
const waitForDialogs = async (count: number): Promise<HTMLElement[]> => {
  let dialogs: HTMLElement[] = []
  await waitFor(
    () => {
      dialogs = screen.queryAllByRole('dialog')
      expect(dialogs).toHaveLength(count)
    },
    { timeout: 5_000 }
  )
  return dialogs
}

const Shell = ({ app }: { app: BrowserApp }) => (
  <BrowserAppShell
    app={app}
    config={SHELL_CONFIG}
    BootScreen={BootScreen}
    globalHosts={NO_GLOBAL_HOST_CAPABILITIES}
  >
    <p>surface</p>
  </BrowserAppShell>
)

let promptCounter = 0
const makeApp = (options: { humanInput?: boolean } = {}): BrowserApp => {
  promptCounter += 1
  return createBrowserApp(
    { storageNamespace: `tinytinkerer-ownership-${promptCounter}` },
    {
      plugins: noPlugins,
      ...(options.humanInput === undefined ? {} : { humanInput: options.humanInput })
    }
  )
}

beforeEach(() => {
  promptCounter = 0
})

afterEach(cleanup)

describe('the human-input capability is one value (issue #489 review, finding 1)', () => {
  it('gives an app that declares no human input no queue at all', () => {
    expect(makeApp({ humanInput: false }).stores.humanPrompts).toBeUndefined()
  })

  it('gives every ordinary app one, without the caller asking', () => {
    // Every product surface: the default must stay "can prompt", or the shells
    // silently lose the permissions gate and the choice tool.
    expect(makeApp().stores.humanPrompts).toBeDefined()
  })

  it('mounts no modal for an app that cannot prompt, even with a shell asking', async () => {
    const app = makeApp({ humanInput: false })
    render(<Shell app={app} />)

    await screen.findByText('surface')
    // Settle any lazy boundary the shell might have started, so "nothing is
    // drawn" is a conclusion rather than a race the assertion happened to win.
    await waitForDialogs(0)
    // Nothing to draw, and — the point of finding 1 — nothing could have been
    // enqueued either, because no queue exists to enqueue onto.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(app.stores.humanPrompts).toBeUndefined()
  })
})

describe('one modal per app across its shells (issue #489 review, finding 2)', () => {
  it('draws a single modal when three shells share one app', async () => {
    const app = makeApp()
    render(
      <>
        <Shell app={app} />
        <Shell app={app} />
        <Shell app={app} />
      </>
    )

    await waitFor(() => expect(screen.getAllByText('surface')).toHaveLength(3))

    act(() => {
      void app.stores.humanPrompts?.getState().request(view, 'conv-a')
    })

    // One dialog, not three.
    const dialogs = await waitForDialogs(1)
    expect(dialogs[0]).toHaveAttribute('aria-modal', 'true')

    // …and it is genuinely usable. Counting dialogs was not enough (issue #489
    // re-review, finding 1): every host used to run `useDialogFocus`, so a LOSING
    // candidate could hold the top of the shared focus stack while rendering
    // nothing, and the one real dialog marked itself `inert` and dropped its focus
    // trap — present in the DOM, unreachable by keyboard.
    expect(dialogs[0]).not.toHaveAttribute('inert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus())
  })

  it('hands the modal to a surviving shell when the owner unmounts, without disturbing the prompt', async () => {
    const app = makeApp()
    const { rerender } = render(
      <>
        <Shell app={app} />
        <Shell app={app} />
      </>
    )
    await waitFor(() => expect(screen.getAllByText('surface')).toHaveLength(2))

    const answer = app.stores.humanPrompts?.getState().request(view, 'conv-a')
    await waitForDialogs(1)

    // The owner goes away — a documentation page navigating a lab out from under
    // a pending question.
    rerender(
      <>
        <Shell app={app} />
      </>
    )

    await waitFor(() => expect(screen.getAllByText('surface')).toHaveLength(1))
    // Still exactly one, drawn by the shell that inherited it, and still the
    // SAME prompt: the queue lives on the app, so replacing its renderer does
    // not settle or restart the question.
    const inherited = await waitForDialogs(1)
    expect(app.stores.humanPrompts?.getState().queue).toHaveLength(1)

    // The inherited dialog is focused and interactive. This is the half of
    // finding 1 that the shared-stack version could not do at all: the new owner
    // had already reported `active` before it had a container, so its membership
    // effect never re-ran and the dialog it finally mounted was never engaged.
    expect(inherited[0]).not.toHaveAttribute('inert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus())

    act(() => {
      app.stores.humanPrompts?.getState().reset('conv-a')
    })
    await expect(answer).resolves.toEqual({ kind: 'dismissed' })
  })

  it('lets two different apps each own a modal at the same time', async () => {
    const assistant = makeApp()
    const lab = makeApp()
    render(
      <>
        <Shell app={assistant} />
        <Shell app={lab} />
      </>
    )
    await waitFor(() => expect(screen.getAllByText('surface')).toHaveLength(2))

    act(() => {
      void assistant.stores.humanPrompts?.getState().request(view, 'conv-a')
      void lab.stores.humanPrompts?.getState().request(view, 'conv-b')
    })

    // Two apps, two modals — the ownership rule is per app, not per document.
    // Serializing them would block one app's run on the other's unanswered
    // question; `use-dialog-focus.ts`'s stack keeps only the topmost interactive.
    const both = await waitForDialogs(2)

    // Exactly one of the two is engaged, and the other is stepped aside rather
    // than both trapping focus or neither doing so. Which one is the stack's
    // business (last opened wins); that it is precisely one is this rule's.
    await waitFor(() => {
      const inert = both.filter((dialog) => dialog.hasAttribute('inert'))
      expect(inert).toHaveLength(1)
    })
  })
})
