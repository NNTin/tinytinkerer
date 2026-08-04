/**
 * The chain a real prompt actually travels (issue #489 review, finding 3).
 *
 * `human-prompt-session-routing.test.tsx` calls the app's queue action directly
 * and the runtime suites inject a callback directly, so between them they proved
 * both ENDS and none of the middle. Every link is an optional option, so deleting
 * the forwarding line in `chat-store.ts` would have left those suites green while
 * silently removing the choice tool from every product surface.
 *
 * This drives the whole thing instead:
 *
 *   app.stores.humanPrompts
 *     → createChatStore
 *     → createBrowserRuntimeFactory        (real)
 *     → createRuntime                      (real)
 *     → PluginHost.requestHumanInput       (real)
 *     → back into THAT app's queue, scoped to the run's conversation
 *
 * The only seam is `executeChatPrompt`, which the chat store already injects for
 * tests and which hands over the runtime factory the store built — so the factory
 * under test is the production one, not a stand-in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatRuntimeFactory, PluginHost, PluginModule } from '@tinytinkerer/app-core'
import type { HumanPromptView } from '@tinytinkerer/contracts'

const mockExecuteChatPrompt = vi.hoisted(() => vi.fn())

vi.mock('@tinytinkerer/app-core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tinytinkerer/app-core')>()
  return { ...original, executeChatPrompt: mockExecuteChatPrompt }
})

vi.mock('../src/db', () => ({
  createBrowserPersistence: () => ({
    preferences: { get: () => Promise.resolve(undefined), set: () => Promise.resolve() },
    // The full `ConversationRepository` port: `sendPrompt` really runs here, so
    // a partial stub fails somewhere unrelated to what this suite is asking.
    conversations: {
      createConversation: () =>
        Promise.resolve({
          id: 'conv-a',
          title: 'New conversation',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z'
        }),
      getLatestConversation: () => Promise.resolve(undefined),
      listConversations: () => Promise.resolve([]),
      loadConversationEvents: () => Promise.resolve([]),
      appendEvent: () => Promise.resolve(),
      clearConversationEvents: () => Promise.resolve(),
      deleteConversation: () => Promise.resolve(),
      updateConversationTitle: () => Promise.resolve()
    },
    authTokens: {
      getStoredToken: () => Promise.resolve(null),
      setStoredToken: () => Promise.resolve(),
      clearStoredToken: () => Promise.resolve()
    }
  })
}))

// A plugin whose only job is to hand back the PluginHost it was built with, so
// the test can call the real `requestHumanInput` the runtime wired.
const PROBE_ID = 'human-input-probe'
let capturedHost: PluginHost | undefined

const probeModule: PluginModule = {
  manifest: { id: PROBE_ID, label: 'probe', description: 'probe', defaultEnabled: true },
  createPlugin: () => ({
    id: PROBE_ID,
    createTools: (host) => {
      capturedHost = host
      return []
    }
  })
}

const { createBrowserApp } = await import('../src/app.js')

// This suite is about a plugin's host actually receiving `requestHumanInput`,
// so the probe travels in as this app's catalogue (issue #495) rather than
// through a module mock — the same route a real plugin takes.
const probePlugins = () => Promise.resolve([probeModule])

const pendingSentinel = Symbol('pending')
const settlementOf = (promise: Promise<unknown>): Promise<unknown> =>
  Promise.race([promise, Promise.resolve(pendingSentinel)])

const view: HumanPromptView = {
  role: 'dialog',
  ariaLabel: 'Assistant question',
  title: 'Pick one',
  actions: [{ id: 'ok', label: 'OK' }],
  dismissLabel: 'Dismiss'
}

/**
 * Sends a prompt and returns the runtime factory the chat store actually built.
 *
 * `executeChatPrompt` is where app-core hands the factory over, which makes it
 * the one place a test can intercept the production object without replacing it.
 */
const runtimeFactoryUsedBy = async (
  app: ReturnType<typeof createBrowserApp>
): Promise<ChatRuntimeFactory> => {
  let factory: ChatRuntimeFactory | undefined
  mockExecuteChatPrompt.mockImplementation((options: { runtimeFactory: ChatRuntimeFactory }) => {
    factory = options.runtimeFactory
    return Promise.resolve()
  })
  await app.stores.chat.getState().sendPrompt('hello')
  if (!factory) throw new Error('The chat store never reached executeChatPrompt.')
  return factory
}

beforeEach(() => {
  capturedHost = undefined
  mockExecuteChatPrompt.mockReset()
})

describe('a prompt raised through the real runtime lands in its own app’s queue', () => {
  it('carries the app’s queue all the way to the PluginHost, scoped to the run', async () => {
    const app = createBrowserApp(
      { storageNamespace: 'tinytinkerer-wiring-a' },
      { plugins: probePlugins }
    )
    const other = createBrowserApp(
      { storageNamespace: 'tinytinkerer-wiring-b' },
      { plugins: probePlugins }
    )

    const factory = await runtimeFactoryUsedBy(app)
    // The runtime the store creates for one run, with that run's conversation.
    factory.create({ conversationId: 'conv-xyz' })

    expect(capturedHost).toBeDefined()
    expect(capturedHost?.requestHumanInput).toBeDefined()

    // Raised the way a real plugin raises it, not by calling the queue.
    void capturedHost?.requestHumanInput?.(view)

    const queued = app.stores.humanPrompts?.getState().queue ?? []
    expect(queued).toHaveLength(1)
    expect(queued[0]?.view.title).toBe('Pick one')
    // Tagged with the run's conversation (issue #430), which is what lets a Stop
    // settle only its own prompts.
    expect(queued[0]?.scope).toBe('conv-xyz')
    // …and nothing reached the other app in the document.
    expect(other.stores.humanPrompts?.getState().queue).toHaveLength(0)
  })

  it('forwards the app’s own request action, not some equivalent function', async () => {
    // Identity, deliberately: a store that built its own queue, or forwarded a
    // wrapper closing over a different one, would satisfy every behavioural
    // assertion above while breaking the routing this issue exists to fix.
    const app = createBrowserApp(
      { storageNamespace: 'tinytinkerer-wiring-identity' },
      { plugins: probePlugins }
    )
    const factory = await runtimeFactoryUsedBy(app)
    factory.create({ conversationId: 'conv-xyz' })

    void capturedHost?.requestHumanInput?.(view)
    const entry = app.stores.humanPrompts?.getState().queue[0]
    expect(entry).toBeDefined()

    // Settling through the app's own store resolves the promise the PluginHost
    // returned, which is only true if they are the same queue object.
    const settled = vi.fn()
    void capturedHost?.requestHumanInput?.(view).then(settled)
    app.stores.humanPrompts?.getState().reset()
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith({ kind: 'dismissed' }))
  })

  it('settles only the finished conversation’s prompts, never a concurrent one', async () => {
    // The observable half of the #498 lifecycle fix. The property it depends on —
    // that agent-core's `withTimeout` abandons rather than cancels the promise it
    // races, so an expired human-input budget leaves the entry queued — is pinned
    // where that helper lives, in
    // `agent-core/tests/with-timeout-does-not-cancel.test.ts`. Re-racing a
    // hardcoded 300_000 here would have been a second copy of the implementation
    // rather than a test of this integration.
    const app = createBrowserApp(
      { storageNamespace: 'tinytinkerer-wiring-cleanup' },
      { plugins: probePlugins }
    )
    const queue = app.stores.humanPrompts
    expect(queue).toBeDefined()

    // Half 2: a run that ends while a prompt is still queued — exactly the state
    // the expired budget leaves behind. The stand-in raises the prompt and returns
    // without it being answered, which is what the real post-timeout run does.
    const stranded = queue!.getState().request(view, 'conv-a')
    // A prompt belonging to a DIFFERENT conversation, running beside it. An
    // unscoped reset here would dismiss somebody else's open question.
    const other = queue!.getState().request(view, 'conv-b')
    other.catch(() => undefined)

    mockExecuteChatPrompt.mockImplementation(() => Promise.resolve())
    await app.stores.chat.getState().sendPrompt('hello')

    await expect(stranded).resolves.toEqual({ kind: 'dismissed' })
    expect(queue!.getState().queue.map((entry) => entry.scope)).toEqual(['conv-b'])
    await expect(settlementOf(other)).resolves.toBe(pendingSentinel)
  })

  it('exposes no human-input capability at all for an app that declares none', async () => {
    const app = createBrowserApp(
      { storageNamespace: 'tinytinkerer-wiring-none' },
      { plugins: probePlugins, humanInput: false }
    )

    const factory = await runtimeFactoryUsedBy(app)
    factory.create({ conversationId: 'conv-xyz' })

    expect(capturedHost).toBeDefined()
    // The whole point of finding 1: with no queue there is no capability, so a
    // HITL plugin contributes no tool rather than enqueueing into nothing.
    expect(capturedHost).not.toHaveProperty('requestHumanInput')
    expect(app.stores.humanPrompts).toBeUndefined()
  })
})
