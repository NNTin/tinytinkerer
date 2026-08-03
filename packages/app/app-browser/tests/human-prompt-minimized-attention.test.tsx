// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

/**
 * A composer-presented question is answerable even when the widget is minimized
 * (issue #498).
 *
 * `FloatingLayout` renders the launcher INSTEAD of `children` while minimized, so
 * the composer dock — and with it the question — is unmounted. Nothing was drawn
 * anywhere: the modal host declines a `composer` prompt by design, so the run
 * blocked on a question no surface was showing, for the whole ~5-minute
 * human-input budget, with the launcher giving no hint.
 *
 * The chosen behaviour keeps the reader in control: stay minimized, badge the
 * launcher, announce politely, and let them restore when they choose. Explicitly
 * NOT auto-restoring (the model would take the screen), NOT falling back to the
 * modal (that overrides the presentation the reader chose), and NOT dismissing
 * early (that changes what the tool observes).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../src/plugins/registry.js', () => ({
  loadPluginModules: vi.fn().mockResolvedValue([])
}))

// jsdom has no `Element.scrollTo`, which the transcript's stick-to-bottom hook
// calls on mount. Stubbed the same way every other surface suite in this package
// stubs it; nothing here asserts on scrolling.
vi.mock('../src/use-stick-to-bottom.js', () => ({
  useStickToBottom: () => ({
    scrollRef: { current: null },
    isPinned: true,
    showJumpButton: false,
    scrollToBottom: () => undefined
  })
}))

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ConversationSlice } from '@tinytinkerer/app-core'
import type { HumanPromptView } from '@tinytinkerer/contracts'
import { AppBrowserProvider, createBrowserApp, type BrowserApp } from '../src/app.js'
import { ChatApp } from '../src/chat-shell/chat-app.js'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

const CHOICE_PROMPT = 'choice-prompt'
const ATTENTION = 'Assistant question waiting. Restore widget to answer.'

const pollView = (overrides: Partial<HumanPromptView> = {}): HumanPromptView => ({
  role: 'dialog',
  ariaLabel: 'Assistant question',
  title: 'The assistant has a question',
  description: 'Pick a colour',
  actions: [
    { id: 'Red', label: 'Red' },
    { id: 'Blue', label: 'Blue' }
  ],
  allowCustom: true,
  dismissLabel: 'Dismiss question',
  dismissAction: { label: 'Skip' },
  source: CHOICE_PROMPT,
  ...overrides
})

const slice = (id: string): ConversationSlice => ({
  id,
  title: 'A conversation',
  events: [],
  isRunning: false,
  isRetryPending: false,
  eventsLoaded: true
})

let appCounter = 0
const makeApp = (presentation: 'modal' | 'composer' = 'composer'): BrowserApp => {
  appCounter += 1
  const app = createBrowserApp({ storageNamespace: `tinytinkerer-attention-${appCounter}` })
  app.stores.settings.setState({
    pluginConfig: { [CHOICE_PROMPT]: { presentation } }
  })
  app.stores.chat.setState({
    hydrated: true,
    conversationId: 'conv-a',
    conversations: { 'conv-a': slice('conv-a') },
    conversationOrder: ['conv-a']
  })
  return app
}

const queueOf = (app: BrowserApp) => {
  const queue = app.stores.humanPrompts
  if (!queue) throw new Error('This test needs an app with the human-input capability.')
  return queue.getState()
}

const Loading = () => <p>loading</p>

const renderWidget = (app: BrowserApp, mode: 'floating' | 'sidebar' = 'floating') =>
  render(
    <AppBrowserProvider app={app}>
      <ChatApp
        mode={mode}
        storageKey={`tinytinkerer:test-${appCounter}`}
        LoadingComponent={Loading}
      />
    </AppBrowserProvider>
  )

/** The launcher, by whichever accessible name it currently carries. */
const launcher = (): HTMLElement =>
  screen.getByRole('button', { name: (name) => name === ATTENTION || name === 'Restore widget' })

/** Minimizes through the real control a reader would press. */
const minimize = async (): Promise<void> => {
  fireEvent.click(screen.getByRole('button', { name: 'Minimize widget' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Restore widget' })).toBeVisible())
}

describe('a composer prompt raised while the widget is minimized', () => {
  it('badges and announces on the launcher without restoring or redrawing as a modal', async () => {
    const app = makeApp()
    renderWidget(app)
    await minimize()

    act(() => {
      void queueOf(app).request(pollView(), 'conv-a')
    })

    // The accessible name now says why the launcher matters.
    const button = await screen.findByRole('button', { name: ATTENTION })
    expect(button).toHaveAttribute('title', ATTENTION)
    expect(button).toHaveAttribute('data-attention', 'true')

    // A polite status carries the same message — and it is NOT the geometry
    // region, which keyboard move/resize overwrites on every step.
    const statuses = screen.getAllByRole('status')
    expect(statuses.some((node) => node.textContent === ATTENTION)).toBe(true)

    // Still minimized: no auto-restore, and no modal stood in for the composer.
    expect(screen.queryByRole('textarea')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(app.stores.humanPrompts?.getState().queue).toHaveLength(1)
  })

  it('shows the question and focuses its first control when restored by keyboard', async () => {
    const app = makeApp()
    renderWidget(app)
    await minimize()

    const answer = queueOf(app).request(pollView(), 'conv-a')
    const button = await screen.findByRole('button', { name: ATTENTION })

    // Keyboard activation of the launcher, not a synthetic presentation change.
    button.focus()
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button)

    // The question is on screen, in the composer dock the reader chose…
    const dock = await screen.findByRole('dialog')
    expect(dock).toHaveTextContent('The assistant has a question')
    expect(dock).not.toHaveAttribute('aria-modal')

    // …and focus is on its first control rather than the message box below it.
    await waitFor(() => expect(within(dock).getByRole('button', { name: 'Red' })).toHaveFocus())

    // Answering resolves the awaiting tool and clears the attention state.
    fireEvent.click(within(dock).getByRole('button', { name: 'Red' }))
    await expect(answer).resolves.toEqual({ kind: 'action', id: 'Red' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await minimize()
    expect(launcher()).not.toHaveAttribute('data-attention')
    expect(screen.getAllByRole('status').some((n) => n.textContent === ATTENTION)).toBe(false)
  })

  it('focuses the free-text field when the question offers no actions', async () => {
    // A view with no actions marked nothing as the autofocus target, so restoring
    // fell through to the ordinary message box — past the question.
    const app = makeApp()
    renderWidget(app)
    await minimize()

    void queueOf(app).request(pollView({ actions: [], allowCustom: true }), 'conv-a')
    fireEvent.click(await screen.findByRole('button', { name: ATTENTION }))

    const dock = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dock).getByLabelText('Or type your own answer')).toHaveFocus()
    )
  })

  it('re-announces when one question replaces another at the head of the queue', async () => {
    const app = makeApp()
    renderWidget(app)
    await minimize()

    const first = queueOf(app).request(pollView({ title: 'First question' }), 'conv-a')
    void queueOf(app).request(pollView({ title: 'Second question' }), 'conv-a')

    await screen.findByRole('button', { name: ATTENTION })
    const announced = () =>
      screen.getAllByRole('status').find((node) => node.textContent === ATTENTION)
        ?.firstElementChild
    const before = announced()
    expect(before).toBeDefined()

    // Settle the head; the queued one takes its place. The message text is the
    // same for both, so the proof of a fresh announcement is that the node inside
    // the live region was replaced rather than reused.
    act(() => {
      first.catch(() => undefined)
      const head = app.stores.humanPrompts?.getState().queue[0]
      head?.resolve({ kind: 'dismissed' })
    })

    await waitFor(() => expect(announced()).not.toBe(before))
    expect(launcher()).toHaveAttribute('data-attention', 'true')
  })

  it('leaves a modal-presentation prompt alone: no badge, no announcement', async () => {
    const app = makeApp('modal')
    renderWidget(app)
    await minimize()

    act(() => {
      void queueOf(app).request(pollView(), 'conv-a')
    })

    // The modal host is mounted by `BrowserAppShell`, which this test does not
    // render — the point here is only that the LAUNCHER stays untouched, because
    // a modal is not hidden by minimizing.
    await waitFor(() => expect(launcher()).toHaveAccessibleName('Restore widget'))
    expect(launcher()).not.toHaveAttribute('data-attention')
  })
})

describe('presentations that were never affected stay unchanged', () => {
  it('draws the dock inline in a docked (sidebar) surface, with no launcher at all', async () => {
    const app = makeApp()
    renderWidget(app, 'sidebar')

    act(() => {
      void queueOf(app).request(pollView(), 'conv-a')
    })

    const dock = await screen.findByRole('dialog')
    expect(dock).toHaveTextContent('The assistant has a question')
    expect(screen.queryByRole('button', { name: 'Restore widget' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ATTENTION })).not.toBeInTheDocument()
  })

  it('draws the dock inline in an open floating surface, with no attention state', async () => {
    const app = makeApp()
    renderWidget(app)

    act(() => {
      void queueOf(app).request(pollView(), 'conv-a')
    })

    const dock = await screen.findByRole('dialog')
    expect(dock).toHaveTextContent('The assistant has a question')
    expect(screen.queryByRole('button', { name: ATTENTION })).not.toBeInTheDocument()
  })
})
