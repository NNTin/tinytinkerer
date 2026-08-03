// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

/**
 * A human prompt is drawn by the session that raised it (issue #489).
 *
 * The queue used to be one module-level store for the whole document, while
 * every reader resolved the prompt's SURROUNDING data from the app it happened
 * to be mounted under. With one `BrowserApp` per document that was invisible.
 * With two — the documentation assistant beside its live labs (#479) — a prompt
 * raised by app A was drawn with app B's per-plugin presentation setting, app
 * B's conversation titles, and settled by app B's Stop/reset.
 *
 * So this suite renders the topology rather than asserting on the queue: two
 * real `BrowserApp`s, each with its own plugin settings and conversations, each
 * with its own mounted renderers, and it asks what the reader actually sees.
 *
 * `AppBrowserProvider` rather than `BrowserAppShell`: what #489 changed is which
 * queue a mounted renderer reads, and the provider is exactly the boundary that
 * answers it. The shell's two contributions — whether the app can prompt at all,
 * and which of its shells draws the modal — are covered next door in
 * `human-prompt-host-ownership.test.tsx`, and the chat-store-to-runtime wiring
 * that gets a prompt into the right queue in the first place is covered in
 * `human-prompt-production-wiring.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// `createBrowserApp` builds a Dexie-backed shell, and jsdom has no IndexedDB.
// Nothing here reads a preference back — no app is bootstrapped — but the
// persistence is constructed lazily per namespace, so an in-memory stand-in
// keeps a stray read from throwing.
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

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ConversationSlice } from '@tinytinkerer/app-core'
import type { HumanPromptView } from '@tinytinkerer/contracts'
import { AppBrowserProvider, createBrowserApp, type BrowserApp } from '../src/app.js'
import { HumanPromptComposerDock } from '../src/human-prompt-composer-dock.js'
import { HumanPromptHost } from '../src/human-prompt-host.js'

afterEach(cleanup)

const CHOICE_PROMPT = 'choice-prompt'

const pollView = (title: string): HumanPromptView => ({
  role: 'dialog',
  ariaLabel: 'Assistant question',
  title,
  actions: [
    { id: 'Red', label: 'Red' },
    { id: 'Blue', label: 'Blue' }
  ],
  // Free text on, because the two id tests below need the labelled input that
  // `useId` now names — and every real choice poll offers it.
  allowCustom: true,
  dismissLabel: 'Dismiss question',
  dismissAction: { label: 'Skip' },
  source: CHOICE_PROMPT
})

const slice = (id: string, title: string): ConversationSlice => ({
  id,
  title,
  events: [],
  isRunning: false,
  isRetryPending: false,
  eventsLoaded: true
})

/**
 * One app, configured the way a real session is: its own storage namespace, its
 * own choice-prompt presentation, and its own conversations.
 */
const makeApp = (options: {
  namespace: string
  presentation: 'modal' | 'composer'
  conversations: { id: string; title: string }[]
}): BrowserApp => {
  const app = createBrowserApp({ storageNamespace: options.namespace })
  app.stores.settings.setState({
    pluginConfig: { [CHOICE_PROMPT]: { presentation: options.presentation } }
  })
  app.stores.chat.setState({
    hydrated: true,
    conversationId: options.conversations[0]?.id,
    conversations: Object.fromEntries(
      options.conversations.map((entry) => [entry.id, slice(entry.id, entry.title)])
    ),
    conversationOrder: options.conversations.map((entry) => entry.id)
  })
  return app
}

/** Both renderers of one session, labelled so a query can name the session. */
const Session = ({ app, label }: { app: BrowserApp; label: string }) => (
  <AppBrowserProvider app={app}>
    <div data-testid={label}>
      <HumanPromptHost />
      <HumanPromptComposerDock />
    </div>
  </AppBrowserProvider>
)

/**
 * The app's queue, with the capability asserted rather than assumed.
 *
 * `stores.humanPrompts` is optional now that its presence IS the human-input
 * capability (issue #489 review, finding 1), so a bare `!` would let a test go on
 * quietly exercising an app that cannot prompt at all.
 */
const queueOf = (app: BrowserApp) => {
  const queue = app.stores.humanPrompts
  if (!queue) throw new Error('This test needs an app with the human-input capability.')
  return queue.getState()
}

const pendingSentinel = Symbol('pending')
const settlementOf = (promise: Promise<unknown>): Promise<unknown> =>
  Promise.race([promise, Promise.resolve(pendingSentinel)])

describe('human prompts route to the originating session (issue #489)', () => {
  it('renders a prompt only in the session that raised it, even on an identical conversation id', async () => {
    // Both sessions hold a conversation called `shared` — the collision that used
    // to be enough for one session's reset to settle the other's prompt.
    const assistant = makeApp({
      namespace: 'tinytinkerer-docs-assistant',
      presentation: 'modal',
      conversations: [
        { id: 'shared', title: 'Assistant conversation' },
        { id: 'second', title: 'Another assistant conversation' }
      ]
    })
    const lab = makeApp({
      namespace: 'tinytinkerer-docs-lab',
      presentation: 'modal',
      conversations: [
        { id: 'shared', title: 'Lab conversation' },
        { id: 'second', title: 'Another lab conversation' }
      ]
    })

    render(
      <>
        <Session app={assistant} label="assistant" />
        <Session app={lab} label="lab" />
      </>
    )

    void queueOf(assistant).request(pollView('Assistant asks'), 'shared')

    const assistantRegion = await screen.findByTestId('assistant')
    expect(within(assistantRegion).getByRole('dialog')).toHaveTextContent('Assistant asks')
    // The lab is mounted, holds a conversation with the same id, and shows nothing.
    expect(within(screen.getByTestId('lab')).queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('takes the presentation choice and conversation label from the originating session', async () => {
    // The assistant draws a choice poll in the composer; the lab draws it in a
    // modal. Before #489 the surface was decided by whichever app the RENDERER
    // sat under, so the same prompt could be drawn either way.
    const assistant = makeApp({
      namespace: 'tinytinkerer-docs-assistant',
      presentation: 'composer',
      conversations: [
        { id: 'conv-a', title: 'Refactor the parser' },
        { id: 'conv-b', title: 'Draft release notes' }
      ]
    })
    const lab = makeApp({
      namespace: 'tinytinkerer-docs-lab',
      presentation: 'modal',
      conversations: [
        { id: 'conv-a', title: 'Lab conversation one' },
        { id: 'conv-b', title: 'Lab conversation two' }
      ]
    })

    render(
      <>
        <Session app={assistant} label="assistant" />
        <Session app={lab} label="lab" />
      </>
    )

    void queueOf(assistant).request(pollView('Assistant asks'), 'conv-a')

    const assistantRegion = await screen.findByTestId('assistant')
    const drawn = within(assistantRegion).getByRole('dialog')
    // The composer dock, not the modal: the dock is a <section>, the modal an
    // aria-modal dialog. Asserting on the modal's own marker keeps this from
    // passing for "some dialog rendered somewhere".
    expect(drawn).not.toHaveAttribute('aria-modal')
    expect(drawn).toHaveTextContent('Refactor the parser')

    // The discriminating half, and the reason this test exists separately from
    // the one above. The originating session drawing its own prompt correctly was
    // never the defect — the assistant's dock read the assistant's settings and
    // titles even when the queue was shared. What went wrong was over here: the
    // lab's modal ALSO drew this prompt, because it resolved `presentation` from
    // the LAB's choice-prompt setting (`modal`) and labelled it with the LAB's
    // title for `conv-a`. So the claim is that the reading session contributes
    // nothing at all to a prompt it did not raise.
    const labRegion = screen.getByTestId('lab')
    expect(within(labRegion).queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/Lab conversation one/)).not.toBeInTheDocument()
  })

  it('settles only the originating session when a conversation with a shared id is reset', async () => {
    const assistant = makeApp({
      namespace: 'tinytinkerer-docs-assistant',
      presentation: 'modal',
      conversations: [{ id: 'shared', title: 'Assistant conversation' }]
    })
    const lab = makeApp({
      namespace: 'tinytinkerer-docs-lab',
      presentation: 'modal',
      conversations: [{ id: 'shared', title: 'Lab conversation' }]
    })

    const assistantPrompt = queueOf(assistant).request(pollView('Assistant asks'), 'shared')
    const labPrompt = queueOf(lab).request(pollView('Lab asks'), 'shared')

    // Stopping the assistant's run settles the assistant's prompt only.
    assistant.stores.chat.getState().stop('shared')

    await expect(assistantPrompt).resolves.toEqual({ kind: 'dismissed' })
    await expect(settlementOf(labPrompt)).resolves.toBe(pendingSentinel)
    expect(queueOf(lab).queue).toHaveLength(1)
  })

  it('lets two sessions hold a modal at once and settles them independently', async () => {
    const assistant = makeApp({
      namespace: 'tinytinkerer-docs-assistant',
      presentation: 'modal',
      conversations: [{ id: 'conv-a', title: 'Assistant conversation' }]
    })
    const lab = makeApp({
      namespace: 'tinytinkerer-docs-lab',
      presentation: 'modal',
      conversations: [{ id: 'conv-b', title: 'Lab conversation' }]
    })

    render(
      <>
        <Session app={assistant} label="assistant" />
        <Session app={lab} label="lab" />
      </>
    )

    const assistantPrompt = queueOf(assistant).request(pollView('Assistant asks'), 'conv-a')
    const labPrompt = queueOf(lab).request(pollView('Lab asks'), 'conv-b')

    // Both queues progress: there is no document-level serializer, deliberately.
    // Blocking one session's plugin run on another session's unanswered question
    // would be the worse behaviour, and the shared dialog stack in
    // `use-dialog-focus.ts` already makes only the topmost dialog interactive.
    const assistantRegion = await screen.findByTestId('assistant')
    const labRegion = screen.getByTestId('lab')
    expect(within(assistantRegion).getByRole('dialog')).toHaveTextContent('Assistant asks')
    expect(within(labRegion).getByRole('dialog')).toHaveTextContent('Lab asks')

    // Answering one leaves the other exactly as it was.
    fireEvent.click(within(labRegion).getByRole('button', { name: 'Blue' }))

    await expect(labPrompt).resolves.toEqual({ kind: 'action', id: 'Blue' })
    await expect(settlementOf(assistantPrompt)).resolves.toBe(pendingSentinel)
    expect(within(screen.getByTestId('assistant')).getByRole('dialog')).toHaveTextContent(
      'Assistant asks'
    )
  })

  it('shows one session’s COMPOSER prompt in every surface of that session, and settles it everywhere at once', async () => {
    // Several surfaces can share one app — apps/host's root composition renders
    // three `ChatApp`s over one session, and every `<LiveLab>` on a documentation
    // page mounts its own shell over one lab app. For the COMPOSER dock that is
    // intended: the dock is part of a chat surface, several surfaces of one
    // session may each show that session's question, and answering through any
    // one settles it for all.
    //
    // The MODAL is not shared this way — it is an app-level interrupt with one
    // owner per app, which `browser-app-shell.test.tsx`'s ownership suite covers.
    // This test is deliberately about the dock, so it does not read as blessing
    // duplicate modals.
    const app = makeApp({
      namespace: 'tinytinkerer-docs-lab',
      presentation: 'composer',
      conversations: [{ id: 'conv-a', title: 'Lab conversation' }]
    })

    render(
      <>
        <Session app={app} label="surface-one" />
        <Session app={app} label="surface-two" />
      </>
    )

    const answer = queueOf(app).request(pollView('One question'), 'conv-a')

    const first = await screen.findByTestId('surface-one')
    const second = screen.getByTestId('surface-two')
    const firstDock = within(first).getByRole('dialog')
    const secondDock = within(second).getByRole('dialog')
    expect(firstDock).toHaveTextContent('One question')
    expect(secondDock).toHaveTextContent('One question')
    // Docks, not modals: neither claims the document.
    expect(firstDock).not.toHaveAttribute('aria-modal')
    expect(secondDock).not.toHaveAttribute('aria-modal')

    // Each dock's free-text field carries its OWN id, so a label cannot point at
    // the other dock's input (issue #489 review, finding 4).
    const firstInput = within(firstDock).getByLabelText('Or type your own answer')
    const secondInput = within(secondDock).getByLabelText('Or type your own answer')
    expect(firstInput.id).not.toBe(secondInput.id)
    expect(firstInput).not.toBe(secondInput)

    fireEvent.click(within(secondDock).getByRole('button', { name: 'Red' }))

    await expect(answer).resolves.toEqual({ kind: 'action', id: 'Red' })
    expect(within(screen.getByTestId('surface-one')).queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('surface-two')).queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gives two apps holding a prompt at once distinct free-text field ids', async () => {
    const assistant = makeApp({
      namespace: 'tinytinkerer-docs-assistant',
      presentation: 'modal',
      conversations: [{ id: 'conv-a', title: 'Assistant conversation' }]
    })
    const lab = makeApp({
      namespace: 'tinytinkerer-docs-lab',
      presentation: 'modal',
      conversations: [{ id: 'conv-b', title: 'Lab conversation' }]
    })

    render(
      <>
        <Session app={assistant} label="assistant" />
        <Session app={lab} label="lab" />
      </>
    )

    void queueOf(assistant).request(pollView('Assistant asks'), 'conv-a')
    void queueOf(lab).request(pollView('Lab asks'), 'conv-b')

    const assistantRegion = await screen.findByTestId('assistant')
    const assistantInput = within(assistantRegion).getByLabelText('Or type your own answer')
    const labInput = within(screen.getByTestId('lab')).getByLabelText('Or type your own answer')

    expect(assistantInput.id).not.toBe(labInput.id)
    // Typing into one is not observable in the other — the concrete failure a
    // shared id produced, since the label resolved to whichever came first.
    fireEvent.change(assistantInput, { target: { value: 'teal' } })
    expect(assistantInput).toHaveValue('teal')
    expect(labInput).toHaveValue('')
  })
})
