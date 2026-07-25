// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@tinytinkerer/contracts'
import type {
  PixelAgentsConversation,
  PixelAgentsStageActions,
  PixelAgentsStageProps
} from '../src/stage-props'
import type { LoadedPixelAgentsWorkspace } from '../src/workspace-db'

const workspace = vi.hoisted(() => ({
  load: vi.fn<(store?: { load: unknown; save: unknown }) => Promise<LoadedPixelAgentsWorkspace>>(),
  save: vi.fn<(value: unknown) => Promise<void>>()
}))

vi.mock('../src/workspace-db', async (importOriginal) => {
  // Pure helpers (resolveAgentNumber/retireAgentNumber/adoptLegacySeat) stay
  // real — only the IndexedDB-backed load/save are mocked, matching how the
  // canvas package's own stage test mocks its equivalent module.
  const actual = await importOriginal<typeof import('../src/workspace-db')>()
  return {
    ...actual,
    loadPixelAgentsWorkspace: workspace.load,
    savePixelAgentsWorkspace: workspace.save
  }
})

import { PixelAgentsWorkspace } from '../src/pixel-agents-stage'

const BOOTSTRAP_JSON = {
  integrationVersion: 1,
  upstream: { commit: 'a'.repeat(40), version: '1.3.0' },
  assets: {
    characters: [],
    pets: [],
    petNames: [],
    floors: [],
    walls: [],
    furnitureCatalog: [],
    furnitureSprites: {}
  },
  defaultLayout: null
}

const chatEvent = (
  value: Partial<ChatEvent> & Pick<ChatEvent, 'id' | 'type' | 'payload'>
): ChatEvent => ({ timestamp: '2026-07-15T00:00:00.000Z', ...value })

const conversation = (
  value: Partial<PixelAgentsConversation> & Pick<PixelAgentsConversation, 'id' | 'title'>
): PixelAgentsConversation => ({ events: [], isRunning: false, eventsLoaded: true, ...value })

const actions = (): PixelAgentsStageActions => ({
  selectConversation: vi.fn(),
  startNewConversation: vi.fn(),
  deleteConversation: vi.fn()
})

// Simulates the sandboxed upstream webview posting a client message back at
// the parent (issue #430: no fake-iframe test harness pre-existed for this
// bridge, so this drives it at the jsdom MessageEvent level, matching how the
// bridge itself listens: `event.source === iframe.contentWindow` and
// `event.origin === 'null'`, the opaque-origin sandboxed frame's actual
// serialization).
type PostMessageSpy = ReturnType<typeof vi.fn<(message: unknown, targetOrigin: string) => void>>

// jsdom's Window#postMessage isn't a plain configurable data property in every
// version, so this replaces it directly on the iframe's contentWindow rather
// than going through `vi.spyOn` (whose overload resolution against `Window`'s
// own `postMessage` overloads doesn't infer cleanly here either).
const spyOnPostMessage = (iframe: HTMLIFrameElement): PostMessageSpy => {
  const spy: PostMessageSpy = vi.fn()
  if (!iframe.contentWindow) throw new Error('iframe not mounted')
  ;(iframe.contentWindow as unknown as { postMessage: PostMessageSpy }).postMessage = spy
  return spy
}

const postFromOffice = (iframe: HTMLIFrameElement, message: unknown): void => {
  const event = new MessageEvent('message', {
    data: {
      channel: 'tinytinkerer:pixel-agents:v1',
      direction: 'client',
      payload: JSON.stringify(message)
    },
    origin: 'null',
    source: iframe.contentWindow
  })
  window.dispatchEvent(event)
}

const renderStage = (
  props: {
    conversations: PixelAgentsConversation[]
    activeConversationId: string | undefined
    actions: PixelAgentsStageActions
  } & Partial<
    Pick<
      PixelAgentsStageProps,
      'resolveUpstreamUrl' | 'workspaceDatabaseName' | 'dockLayoutStorageKey' | 'onBootstrapError'
    >
  >
) =>
  render(
    <PixelAgentsWorkspace
      assistant={<div>assistant</div>}
      conversations={props.conversations}
      activeConversationId={props.activeConversationId}
      actions={props.actions}
      {...(props.resolveUpstreamUrl ? { resolveUpstreamUrl: props.resolveUpstreamUrl } : {})}
      {...(props.workspaceDatabaseName
        ? { workspaceDatabaseName: props.workspaceDatabaseName }
        : {})}
      {...(props.dockLayoutStorageKey ? { dockLayoutStorageKey: props.dockLayoutStorageKey } : {})}
      {...(props.onBootstrapError ? { onBootstrapError: props.onBootstrapError } : {})}
    />
  )

const bootstrap = async (iframe: HTMLIFrameElement, postSpy: PostMessageSpy): Promise<void> => {
  await act(async () => {
    postFromOffice(iframe, { type: 'webviewReady' })
    // Let the bootstrap fetch()/loadPixelAgentsWorkspace() promises resolve.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
  void postSpy
}

// Host -> iframe messages are posted RAW (not enveloped): upstream's own
// PostMessageTransport reads `event.data` directly as the message once the
// injected acquireVsCodeApi shim makes it the active transport (see
// pixel-agents-stage.tsx's postToPixelAgents).
const postedMessages = (postSpy: PostMessageSpy): unknown[] =>
  postSpy.mock.calls.map((call) => call[0])

beforeEach(() => {
  workspace.load.mockReset().mockResolvedValue({ record: null, migratedFromLegacy: false })
  workspace.save.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(BOOTSTRAP_JSON)
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PixelAgentsWorkspace bootstrap', () => {
  it('announces every current conversation as an agent and selects the active one', async () => {
    const conversations = [
      conversation({ id: 'conv-a', title: 'First', isRunning: true }),
      conversation({
        id: 'conv-b',
        title: 'Second',
        events: [chatEvent({ id: 'e1', type: 'agent.run.completed', payload: { steps: 1 } })]
      })
    ]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-b',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)

    await bootstrap(iframe, postSpy)

    const messages = postedMessages(postSpy)
    expect(messages).toContainEqual({
      type: 'existingAgents',
      agents: [1, 2],
      agentMeta: {},
      folderNames: { '1': 'First', '2': 'Second' },
      externalAgents: { '1': false, '2': false }
    })
    expect(messages).toContainEqual({ type: 'agentSelected', id: 2 })
    // conv-a is running -> active, no awaitingInput field.
    expect(messages).toContainEqual({ type: 'agentStatus', id: 1, status: 'active' })
    // conv-b has a completed run in its events -> not awaiting input.
    expect(messages).toContainEqual({
      type: 'agentStatus',
      id: 2,
      status: 'waiting',
      awaitingInput: false
    })
  })

  it('does not mark an unhydrated background conversation as awaiting input', async () => {
    // After a reload only the active conversation's events are hydrated; a
    // background conversation arrives with an EMPTY, eventsLoaded:false array,
    // which says nothing about whether a run ever completed — it must not be
    // announced as awaiting input.
    const conversations = [
      conversation({ id: 'conv-a', title: 'Active', events: [], eventsLoaded: true }),
      conversation({ id: 'conv-b', title: 'Background', events: [], eventsLoaded: false })
    ]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-a',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)

    await bootstrap(iframe, postSpy)

    const messages = postedMessages(postSpy)
    // The active conversation is genuinely fresh (hydrated, no completed run):
    // awaiting input. The unhydrated background one is not.
    expect(messages).toContainEqual({
      type: 'agentStatus',
      id: 1,
      status: 'waiting',
      awaitingInput: true
    })
    expect(messages).toContainEqual({
      type: 'agentStatus',
      id: 2,
      status: 'waiting',
      awaitingInput: false
    })
  })

  it('adopts a legacy single-agent seat onto the oldest conversation', async () => {
    workspace.load.mockResolvedValue({
      record: {
        id: 'default',
        layout: null,
        agentMeta: { 1: { palette: 4, hueShift: 20 } },
        agentNumbers: {},
        nextAgentNumber: 2,
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      migratedFromLegacy: true
    })
    // Most-recent-first, as the store's conversationOrder is: "conv-newest" was
    // created after "conv-oldest".
    const conversations = [
      conversation({ id: 'conv-newest', title: 'Newest' }),
      conversation({ id: 'conv-oldest', title: 'Oldest' })
    ]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-oldest',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)

    await bootstrap(iframe, postSpy)

    const messages = postedMessages(postSpy)
    const existingAgents = messages.find(
      (message): message is { type: 'existingAgents'; folderNames: Record<string, string> } =>
        (message as { type: string }).type === 'existingAgents'
    )
    // Oldest conversation adopts agent 1 (and therefore its seat), not the
    // newest one, regardless of array order.
    expect(existingAgents?.folderNames).toEqual({ '1': 'Oldest', '2': 'Newest' })
    expect(messages).toContainEqual({
      type: 'existingAgents',
      // Order follows the `conversations` prop order (newest, oldest); ids
      // reflect the adoption (oldest -> 1) and the fresh assignment (newest -> 2).
      agents: [2, 1],
      agentMeta: { '1': { palette: 4, hueShift: 20 } },
      folderNames: { '1': 'Oldest', '2': 'Newest' },
      externalAgents: { '1': false, '2': false }
    })
  })

  it('does not adopt a stale agent-1 seat onto any conversation for a non-migrated record (issue #430 invariant)', async () => {
    // Same shape as a freshly migrated record (empty agentNumbers, stale meta
    // for agent 1) but `migratedFromLegacy: false` — e.g. a post-#430 user who
    // deleted every conversation while agent 1's seat lingered. Adoption must
    // NOT fire: retired number 1 must never land on an unrelated conversation.
    workspace.load.mockResolvedValue({
      record: {
        id: 'default',
        layout: null,
        agentMeta: { 1: { palette: 4, hueShift: 20 } },
        agentNumbers: {},
        nextAgentNumber: 2,
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      migratedFromLegacy: false
    })
    const conversations = [
      conversation({ id: 'conv-newest', title: 'Newest' }),
      conversation({ id: 'conv-oldest', title: 'Oldest' })
    ]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-oldest',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)

    await bootstrap(iframe, postSpy)

    const messages = postedMessages(postSpy)
    const existingAgents = messages.find(
      (message): message is { type: 'existingAgents'; folderNames: Record<string, string> } =>
        (message as { type: string }).type === 'existingAgents'
    )
    // Neither conversation gets the stale/retired number 1; both are freshly
    // assigned starting at nextAgentNumber (2), leaving 1 unclaimed.
    expect(existingAgents?.folderNames).toEqual({ '2': 'Newest', '3': 'Oldest' })
    expect(messages).toContainEqual({
      type: 'existingAgents',
      agents: [2, 3],
      agentMeta: { '1': { palette: 4, hueShift: 20 } },
      folderNames: { '2': 'Newest', '3': 'Oldest' },
      externalAgents: { '2': false, '3': false }
    })
  })
})

describe('PixelAgentsWorkspace reconciliation', () => {
  it('posts agentCreated for a conversation added after bootstrap', async () => {
    const initial = [conversation({ id: 'conv-a', title: 'First' })]
    const { container, rerender } = renderStage({
      conversations: initial,
      activeConversationId: 'conv-a',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)
    await bootstrap(iframe, postSpy)
    postSpy.mockClear()

    await act(async () => {
      rerender(
        <PixelAgentsWorkspace
          assistant={<div>assistant</div>}
          conversations={[...initial, conversation({ id: 'conv-b', title: 'Second' })]}
          activeConversationId="conv-b"
          actions={actions()}
        />
      )
      await Promise.resolve()
    })

    const messages = postedMessages(postSpy)
    expect(messages).toContainEqual({ type: 'agentCreated', id: 2, folderName: 'Second' })
    expect(messages).toContainEqual({
      type: 'agentStatus',
      id: 2,
      status: 'waiting',
      awaitingInput: true
    })
  })

  it('posts agentClosed and retires the number for a deleted conversation', async () => {
    const initial = [
      conversation({ id: 'conv-a', title: 'First' }),
      conversation({ id: 'conv-b', title: 'Second' })
    ]
    const { container, rerender } = renderStage({
      conversations: initial,
      activeConversationId: 'conv-a',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)
    await bootstrap(iframe, postSpy)
    postSpy.mockClear()

    await act(async () => {
      rerender(
        <PixelAgentsWorkspace
          assistant={<div>assistant</div>}
          conversations={[conversation({ id: 'conv-a', title: 'First' })]}
          activeConversationId="conv-a"
          actions={actions()}
        />
      )
      await Promise.resolve()
    })

    const messages = postedMessages(postSpy)
    expect(messages).toContainEqual({ type: 'agentClosed', id: 2 })
  })

  it('does not reuse a retired agent number for a later conversation', async () => {
    const initial = [
      conversation({ id: 'conv-a', title: 'First' }),
      conversation({ id: 'conv-b', title: 'Second' })
    ]
    const { container, rerender } = renderStage({
      conversations: initial,
      activeConversationId: 'conv-a',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)
    await bootstrap(iframe, postSpy)

    // Delete conv-b (agent 2), then add conv-c: it must get agent 3, not a
    // reused 2.
    await act(async () => {
      rerender(
        <PixelAgentsWorkspace
          assistant={<div>assistant</div>}
          conversations={[conversation({ id: 'conv-a', title: 'First' })]}
          activeConversationId="conv-a"
          actions={actions()}
        />
      )
      await Promise.resolve()
    })
    postSpy.mockClear()
    await act(async () => {
      rerender(
        <PixelAgentsWorkspace
          assistant={<div>assistant</div>}
          conversations={[
            conversation({ id: 'conv-a', title: 'First' }),
            conversation({ id: 'conv-c', title: 'Third' })
          ]}
          activeConversationId="conv-c"
          actions={actions()}
        />
      )
      await Promise.resolve()
    })

    const messages = postedMessages(postSpy)
    expect(messages).toContainEqual({ type: 'agentCreated', id: 3, folderName: 'Third' })
  })
})

describe('PixelAgentsWorkspace office-driven actions', () => {
  it('dispatches focusAgent, launchAgent, and closeAgent to the store actions', async () => {
    const conversations = [
      conversation({ id: 'conv-a', title: 'First' }),
      conversation({ id: 'conv-b', title: 'Second' })
    ]
    const stageActions = actions()
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-a',
      actions: stageActions
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)
    await bootstrap(iframe, postSpy)

    act(() => {
      postFromOffice(iframe, { type: 'focusAgent', id: 2 })
    })
    expect(stageActions.selectConversation).toHaveBeenCalledWith('conv-b')

    act(() => {
      postFromOffice(iframe, { type: 'launchAgent' })
    })
    expect(stageActions.startNewConversation).toHaveBeenCalled()

    act(() => {
      postFromOffice(iframe, { type: 'closeAgent', id: 1 })
    })
    expect(stageActions.deleteConversation).toHaveBeenCalledWith('conv-a')
  })

  it('persists every saveAgentSeats entry keyed by agent number, not just "1"', async () => {
    const conversations = [
      conversation({ id: 'conv-a', title: 'First' }),
      conversation({ id: 'conv-b', title: 'Second' })
    ]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-a',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)
    await bootstrap(iframe, postSpy)
    workspace.save.mockClear()

    await act(async () => {
      postFromOffice(iframe, {
        type: 'saveAgentSeats',
        seats: {
          '1': { palette: 1, hueShift: 10, seatId: 'desk-1' },
          '2': { palette: 2, hueShift: 20, seatId: null }
        }
      })
      // persistWorkspace's save is queued (saveQueueRef), not synchronous.
      await Promise.resolve()
    })

    expect(workspace.save).toHaveBeenCalledWith(
      expect.objectContaining({
        agentMeta: {
          1: { palette: 1, hueShift: 10, seatId: 'desk-1' },
          2: { palette: 2, hueShift: 20 }
        }
      }),
      expect.anything()
    )
  })

  it('drops saveAgentSeats entries for a number not currently assigned to any conversation (issue #430 invariant)', async () => {
    // Only conv-a exists, so only agent number 1 is currently assigned. The
    // sandboxed (untrusted) iframe is not to be trusted to only name assigned
    // numbers — e.g. number 99 could be a stale/retired number from earlier
    // create/delete churn, or simply malformed input.
    const conversations = [conversation({ id: 'conv-a', title: 'First' })]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-a',
      actions: actions()
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)
    await bootstrap(iframe, postSpy)
    workspace.save.mockClear()

    await act(async () => {
      postFromOffice(iframe, {
        type: 'saveAgentSeats',
        seats: {
          '1': { palette: 1, hueShift: 10, seatId: 'desk-1' },
          '99': { palette: 9, hueShift: 90, seatId: null }
        }
      })
      await Promise.resolve()
    })

    expect(workspace.save).toHaveBeenCalledWith(
      expect.objectContaining({
        agentMeta: {
          1: { palette: 1, hueShift: 10, seatId: 'desk-1' }
        }
      }),
      expect.anything()
    )
  })
})

describe('PixelAgentsWorkspace host contract (issue #452)', () => {
  it('resolves upstream assets through a supplied resolveUpstreamUrl instead of document.baseURI', async () => {
    const resolveUpstreamUrl = vi.fn((path: string) => `https://docs.example/upstream/${path}`)
    const conversations = [conversation({ id: 'conv-a', title: 'First' })]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-a',
      actions: actions(),
      resolveUpstreamUrl
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)

    await bootstrap(iframe, postSpy)

    expect(resolveUpstreamUrl).toHaveBeenCalledWith('index.html')
    expect(resolveUpstreamUrl).toHaveBeenCalledWith('tinytinkerer-bootstrap.json')
    // The `tinytinkerer-parent-origin` query param is appended on top of the
    // resolver's own URL, so only the origin+pathname are asserted here.
    expect(iframe.src.startsWith('https://docs.example/upstream/index.html')).toBe(true)
    expect(fetch).toHaveBeenCalledWith('https://docs.example/upstream/tinytinkerer-bootstrap.json')
  })

  it('reports bootstrap failure (and recovery) through onBootstrapError instead of only its own inline UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    )
    const onBootstrapError = vi.fn()
    const conversations = [conversation({ id: 'conv-a', title: 'First' })]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-a',
      actions: actions(),
      onBootstrapError
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)

    // Fires once on mount with the initial "no error yet" value.
    expect(onBootstrapError).toHaveBeenCalledWith(null)

    await bootstrap(iframe, postSpy)

    expect(onBootstrapError).toHaveBeenLastCalledWith(expect.stringContaining('500'))
  })

  it('persists the workspace through a caller-supplied database name, not the shared product default', async () => {
    const conversations = [conversation({ id: 'conv-a', title: 'First' })]
    const { container } = renderStage({
      conversations,
      activeConversationId: 'conv-a',
      actions: actions(),
      workspaceDatabaseName: 'tinytinkerer-docs-lab-pixel-agents'
    })
    const iframe = container.querySelector('iframe')
    if (!iframe?.contentWindow) throw new Error('iframe not mounted')
    const postSpy = spyOnPostMessage(iframe)

    // loadPixelAgentsWorkspace/savePixelAgentsWorkspace are mocked at the
    // module level (see the vi.mock above), so this only verifies the load
    // path was reached at all with a store instance — the real store-name
    // plumbing (a distinct IndexedDB database per name) is covered by
    // workspace-db.test.ts's createPixelAgentsWorkspaceStore tests.
    await bootstrap(iframe, postSpy)
    expect(workspace.load).toHaveBeenCalledTimes(1)
    const passedStore = workspace.load.mock.calls[0]?.[0]
    expect(typeof passedStore?.load).toBe('function')
    expect(typeof passedStore?.save).toBe('function')
  })
})
