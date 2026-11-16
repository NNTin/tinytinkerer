import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildConversationHistory,
  buildTurns,
  executeChatPrompt,
  type ChatRuntimeFactory
} from '@tinytinkerer/app-core'
import {
  buildMcpCallResponse,
  EDGE_ROUTE_PATHS,
  mcpCallResponseSchema,
  type ChatEvent,
  type McpCallRequest,
  type McpDiscoveryResult,
  type McpServerConfig
} from '@tinytinkerer/contracts'
import type { AppRunRecovery, AppToolResultRecord } from '../src/app-assistant-policy'
import { createBrowserPersistence } from '../src/db'
import { createRuntime } from '../src/runtime/create-runtime'
import type { RunCheckpoint } from '../src/runtime/run-checkpoint'

vi.mock('../src/telemetry/telemetry', async () => ({
  ...(await vi.importActual<typeof import('../src/telemetry/telemetry')>(
    '../src/telemetry/telemetry'
  )),
  getTelemetryHeaders: () => ({})
}))

// Issue #531: successful tool work survives a terminal decision failure and an
// explicit Resume continues it — across a real IndexedDB round trip (Dexie over
// fake-indexeddb, a fresh database connection standing in for a reload).
//
// Only HTTP is scripted. The edge's MCP envelope producer, the SSE parser,
// LiteLLMProvider, the app-core adapter, ReAct, app-core's executeChatPrompt
// (which persists events) and the checkpointing decorator all run for real,
// under fake time so a genuine 90s first-response timeout can be injected.
//
// The MCP server is a domain-neutral stateful design service: one opaque
// project, two mutations, then a guide-sized artifact. The scripted model
// derives its next step from the tool messages it is actually sent, so a
// Resume that lost an observation would visibly repeat work.

const SERVER: McpServerConfig = {
  id: 'designs',
  name: 'Designs',
  url: 'https://designs.test/mcp',
  enabled: true
}
const TOOLS = ['create_project', 'add_parts', 'add_links', 'build_guide'] as const
const PLAN = [...TOOLS, 'final'] as const

type Fault = 'hang' | { rateLimitMs: number }

const discovery = (tools: readonly string[] = TOOLS): Record<string, McpDiscoveryResult> => ({
  [SERVER.id]: {
    serverId: SERVER.id,
    serverName: SERVER.name,
    syncedAt: '2026-11-15T00:00:00.000Z',
    tools: tools.map((toolName) => ({
      toolName,
      description: `Design service ${toolName}`,
      inputSchema: { type: 'object', properties: {}, additionalProperties: true }
    }))
  }
})

const sse = (chunks: unknown[]) =>
  new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
    {
      headers: { 'content-type': 'text/event-stream' }
    }
  )
const toolCall = (wire: string, args: unknown) =>
  sse([
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'c', function: { name: wire, arguments: JSON.stringify(args) } }
            ]
          }
        }
      ]
    },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
  ])
const final = () =>
  sse([
    { choices: [{ delta: { content: 'All steps are complete.' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] }
  ])
const hang = (signal: AbortSignal | null | undefined) =>
  new Response(
    new ReadableStream({
      start(controller) {
        signal?.addEventListener('abort', () =>
          controller.error(new DOMException('Aborted', 'AbortError'))
        )
      }
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  )
const rateLimited = (retryAfterMs: number) =>
  new Response(
    JSON.stringify({
      code: 'rate_limited',
      error: 'Expected backoff',
      retryAfterMs,
      retryAt: new Date(Date.now() + retryAfterMs).toISOString()
    }),
    { status: 429, headers: { 'content-type': 'application/json' } }
  )

type WireMessage = { role: string; content: string | null }

const guideFor = (projectId: string, marker: string) =>
  JSON.stringify({
    marker,
    projectId,
    steps: Array.from({ length: 90 }, (_, index) => ({
      id: `s-${index}`,
      note: `Connect "${index}" to bus ${index % 7}\nkeep 2 mm ⌀ clearance`
    }))
  })

const world = () => {
  const projects = new Map<string, { parts: unknown[]; links: unknown[] }>()
  const mcpCalls: { tool: string; args: Record<string, unknown> }[] = []
  const decisions: string[] = []
  const faults = new Map<number, Fault>()
  const hangTools = new Set<string>()
  const marker = `GUIDE-${crypto.randomUUID()}`

  const projectIdIn = (messages: WireMessage[]): string | undefined => {
    for (const message of messages) {
      if (message.role !== 'tool' || !message.content || message.content.startsWith('Error'))
        continue
      const envelope = JSON.parse(message.content) as {
        toolName?: string
        raw?: { content?: { text?: string }[] }
      }
      if (envelope.toolName === 'create_project') {
        return (JSON.parse(envelope.raw?.content?.[0]?.text ?? '{}') as { projectId?: string })
          .projectId
      }
    }
  }

  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? init.body : '{}'
    if (url.endsWith(EDGE_ROUTE_PATHS.mcpCall)) {
      const request = JSON.parse(body) as McpCallRequest
      const args = request.arguments ?? {}
      mcpCalls.push({ tool: request.toolName, args })
      if (hangTools.has(request.toolName)) {
        // The server acts, but the response is lost: the page dies first.
        if (request.toolName === 'create_project')
          projects.set(crypto.randomUUID(), { parts: [], links: [] })
        return new Promise<Response>(() => {})
      }
      const reply = (result: unknown) =>
        new Response(
          JSON.stringify(
            mcpCallResponseSchema.parse(
              buildMcpCallResponse(SERVER.name, request.toolName, {
                content: [{ type: 'text', text: JSON.stringify(result) }]
              })
            )
          )
        )
      const project = projects.get(String(args.projectId))
      switch (request.toolName) {
        case 'create_project': {
          const projectId = crypto.randomUUID()
          projects.set(projectId, { parts: [], links: [] })
          return reply({ projectId })
        }
        case 'add_parts':
          project?.parts.push(args.parts)
          return reply({ accepted: Boolean(project) })
        case 'add_links':
          project?.links.push(args.links)
          return reply({ accepted: Boolean(project) })
        case 'build_guide':
          return new Response(
            JSON.stringify(
              buildMcpCallResponse(SERVER.name, request.toolName, {
                content: [{ type: 'text', text: guideFor(String(args.projectId), marker) }]
              })
            )
          )
      }
      return new Response('{}', { status: 404 })
    }

    const request = JSON.parse(body) as {
      tool_choice?: string
      messages: WireMessage[]
      tools?: { function: { name: string } }[]
    }
    if (request.tool_choice === 'none') {
      return sse([{ choices: [{ delta: { content: 'Summary.' } }] }])
    }
    decisions.push(body)
    const fault = faults.get(decisions.length)
    if (fault === 'hang') return hang(init.signal)
    if (fault) return rateLimited(fault.rateLimitMs)
    const step = PLAN[request.messages.filter((message) => message.role === 'tool').length]!
    if (step === 'final') return final()
    const wire = request.tools
      ?.map((tool) => tool.function.name)
      .find((name) => name.endsWith(`_${step}`))
    if (!wire) return final()
    const projectId = projectIdIn(request.messages)
    return toolCall(
      wire,
      step === 'create_project'
        ? { name: 'demo' }
        : { projectId, [step === 'add_parts' ? 'parts' : 'links']: [step] }
    )
  })

  return { projects, mcpCalls, decisions, faults, hangTools, marker }
}

type World = ReturnType<typeof world>

const projectIdOf = (results: readonly AppToolResultRecord[]): string | undefined => {
  const created = results.find((result) => result.toolId.endsWith(':create_project'))
  const text = (created?.output as { text?: string } | undefined)?.text
  return text ? (JSON.parse(text) as { projectId: string }).projectId : undefined
}

// Lets fake time and real I/O (fake-indexeddb schedules with setImmediate)
// both make progress until `promise` settles.
const drive = async <T>(promise: Promise<T>, stepMs = 250, limitMs = 2_000_000): Promise<T> => {
  let settled = false
  void promise.then(
    () => (settled = true),
    () => (settled = true)
  )
  for (let elapsed = 0; !settled && elapsed < limitMs; elapsed += stepMs) {
    await new Promise((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(stepMs)
  }
  return promise
}
const until = async (check: () => Promise<boolean>) => {
  for (let index = 0; index < 4000; index += 1) {
    if (await check()) return
    await new Promise((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(5)
  }
  throw new Error('condition not reached')
}

const browser = async (w: World, options: { recovery?: AppRunRecovery } = {}) => {
  const namespace = `tt-531-${crypto.randomUUID()}`
  // One page's connection. A reload kills the previous page: its in-flight run
  // can neither write nor continue, as when the tab is gone.
  const open = () => {
    const raw = createBrowserPersistence(namespace, null)
    let dead = false
    const guard = <T extends object>(target: T): T =>
      new Proxy(target, {
        get: (object, key) => {
          const value = Reflect.get(object, key) as unknown
          return typeof value === 'function'
            ? (...args: unknown[]) =>
                dead
                  ? Promise.reject(new Error('page closed'))
                  : (value as (...a: unknown[]) => unknown).apply(object, args)
            : value
        }
      })
    pages.push(() => (dead = true))
    return {
      conversations: guard(raw.conversations),
      preferences: guard(raw.preferences),
      runCheckpoints: guard(raw.runCheckpoints),
      kill: () => (dead = true)
    }
  }
  let persistence = open()
  const conversation = await persistence.conversations.createConversation()
  const host = { exported: [] as string[], revalidated: 0 }
  const config = {
    token: 'token-a' as string | null,
    tools: TOOLS as readonly string[],
    server: SERVER
  }

  const recovery: AppRunRecovery = options.recovery ?? {
    // The fake host checks that the saved project still exists on its server.
    revalidate: ({ results }) => {
      host.revalidated += 1
      return Promise.resolve(
        w.projects.has(projectIdOf(results) ?? '')
          ? { ok: true }
          : { ok: false, reason: 'The saved design no longer exists on its server.' }
      )
    }
  }

  const factory = (page: typeof persistence, resume?: { turnId: string }): ChatRuntimeFactory => ({
    create: (context) =>
      createRuntime({
        baseUrl: '',
        getToken: () => config.token,
        getModel: () => 'openai/gpt-6.1-sol',
        agentType: 'react',
        mcpServers: [config.server],
        mcpDiscovery: discovery(config.tools),
        appAssistantPolicy: {
          recovery,
          // The fake host opens and exports the design the run's results name.
          finalizeAnswer: ({ source, results }) => {
            const projectId = projectIdOf(results)
            if (projectId && w.projects.has(projectId)) host.exported.push(projectId)
            return source
          }
        },
        ...(context?.conversationId ? { conversationId: context.conversationId } : {}),
        checkpoints: () => Promise.resolve(page.runCheckpoints),
        ...(resume ? { resume } : {})
      })
  })

  const events = () => persistence.conversations.loadConversationEvents(conversation.id)
  const checkpoint = async () =>
    (await persistence.runCheckpoints.get(conversation.id)) as RunCheckpoint | undefined
  const latestTurnId = async () =>
    (await events()).filter((event) => event.type === 'user.message').at(-1)!.id

  const run = (options: { prompt?: string; resume?: boolean; signal?: AbortSignal } = {}) => {
    const live: ChatEvent[] = []
    const page = persistence
    const promise = (async () => {
      const existing = await events()
      const resume = options.resume ? { turnId: await latestTurnId() } : undefined
      await executeChatPrompt({
        conversationId: conversation.id,
        existingEvents: existing,
        prompt: options.prompt ?? 'Make the design and its guide.',
        runtimeFactory: factory(page, resume),
        conversations: page.conversations,
        preferences: page.preferences,
        ...(options.signal ? { signal: options.signal } : {}),
        onEvent: (event) => void live.push(event),
        onRateLimitState: () => {}
      })
      return live
    })()
    return { live, promise }
  }

  return {
    host,
    config,
    events,
    checkpoint,
    conversationId: conversation.id,
    run: (options?: Parameters<typeof run>[0]) => drive(run(options).promise),
    start: run,
    // A fresh connection to the same database: what a page reload gets.
    reload: () => {
      persistence.kill()
      persistence = open()
    },
    store: () => persistence.runCheckpoints
  }
}

const creations = (w: World) => w.mcpCalls.filter((call) => call.tool === 'create_project').length
const mutations = (w: World) =>
  w.mcpCalls.filter((call) => call.tool !== 'build_guide').map((call) => call.tool)
const notices = (events: ChatEvent[]) =>
  events.flatMap((event) => (event.type === 'system' ? [event.payload.message] : []))
const answers = (events: ChatEvent[]) =>
  events.flatMap((event) => (event.type === 'assistant.done' ? [event.payload.source] : []))

// The common failure: four successful calls, then the next decision times out.
const failAfterGuide = async (w: World, b: Awaited<ReturnType<typeof browser>>) => {
  w.faults.set(5, 'hang')
  await b.run()
}

// Every page opened by a test; afterEach kills them, so an abandoned run can
// never reach the next test's scripted fetch.
const pages: (() => void)[] = []

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
  })
})
afterEach(() => {
  for (const kill of pages.splice(0)) kill()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('saved progress and explicit Resume (issue #531)', () => {
  it('keeps the work of a run whose next decision timed out, and Resume finishes the SAME design after a reload', async () => {
    const w = world()
    const b = await browser(w)
    await failAfterGuide(w, b)

    // Truthful partial completion instead of the generic fallback.
    const failed = await b.events()
    expect(
      failed.some(
        (event) => event.type === 'error' && event.payload.message === 'ReAct decision timed out'
      )
    ).toBe(true)
    const partial = answers(failed).at(-1)!
    expect(partial).toContain('This run stopped before it finished.')
    for (const tool of TOOLS) expect(partial).toContain(`mcp:designs:${tool}`)
    expect(partial).toContain('Resume')
    expect(partial).toContain('not proof that its output was checked, rendered or exported')
    const [projectId] = [...w.projects.keys()]
    expect(partial).not.toContain(projectId)
    expect(partial).not.toContain(w.marker)

    // The checkpoint holds the authoritative record: full envelopes (the
    // `text` alias included), host-stamped source and the run's own call ids.
    const saved = (await b.checkpoint())!
    expect(saved).toMatchObject({
      version: 1,
      state: 'stopped',
      stop: 'failed',
      agentType: 'react'
    })
    expect(saved.inFlight).toBeUndefined()
    const completedIds = failed.flatMap((event) =>
      event.type === 'agent.tool.completed' ? [event.payload.stepId] : []
    )
    expect(saved.invocations.map((call) => call.callId)).toEqual(completedIds)
    expect(
      saved.invocations.every(
        (call) => call.source?.kind === 'mcp' && call.source.groupId === 'designs'
      )
    ).toBe(true)
    const guide = saved.invocations[3]!.outcome as { ok: true; output: { text: string } }
    expect(guide.output.text).toBe(guideFor(projectId!, w.marker))
    expect(JSON.stringify(saved)).not.toContain('token-a')

    b.reload()
    const before = w.decisions.length
    await b.run({ resume: true })

    // Exactly one creation, no completed mutation repeated, and the fake host
    // validated and exported the very project the first run created.
    expect(creations(w)).toBe(1)
    expect(mutations(w)).toEqual(['create_project', 'add_parts', 'add_links'])
    expect(w.mcpCalls).toHaveLength(4)
    expect(b.host.revalidated).toBe(1)
    expect(b.host.exported).toEqual([projectId])

    // The resumed decision saw every restored observation in the #532 compact
    // projection: the guide once, no `text` alias.
    const resumed = w.decisions[before]!
    expect(resumed.split(w.marker).length - 1).toBe(1)
    const tools = (JSON.parse(resumed) as { messages: WireMessage[] }).messages.filter(
      (m) => m.role === 'tool'
    )
    expect(tools).toHaveLength(4)
    for (const message of tools) expect(JSON.parse(message.content!)).not.toHaveProperty('text')

    // Finished: the checkpoint is gone; the turn is one turn with the final
    // answer, the resumed activity is inspectable, and history pairs once.
    expect(await b.checkpoint()).toBeUndefined()
    const all = await b.events()
    expect(all.filter((event) => event.type === 'user.message')).toHaveLength(1)
    const turns = buildTurns(all)
    expect(turns).toHaveLength(1)
    expect(turns[0]!.assistantSource).toBe('Summary.')
    expect(turns[0]!.notice).toBeUndefined()
    expect(
      turns[0]!.activity.items.some(
        (item) => item.kind === 'label' && item.label === 'Resumed with 4 saved tool results'
      )
    ).toBe(true)
    expect(buildConversationHistory(all)).toEqual([
      { role: 'user', content: 'Make the design and its guide.' },
      { role: 'assistant', content: 'Summary.' }
    ])
  })

  it('blocks a Resume whose saved project is gone, without creating a replacement', async () => {
    const w = world()
    const b = await browser(w)
    await failAfterGuide(w, b)
    w.projects.clear()
    const before = w.decisions.length

    await b.run({ resume: true })

    expect(w.decisions).toHaveLength(before)
    expect(w.mcpCalls).toHaveLength(4)
    expect(creations(w)).toBe(1)
    const events = await b.events()
    expect(notices(events)).toEqual([
      'Resume stopped: The saved design no longer exists on its server.'
    ])
    expect((await b.checkpoint())!.blocked).toEqual({
      reason: 'The saved design no longer exists on its server.',
      retryable: false
    })
    // The activity stays inspectable, and the record remains as evidence.
    expect(
      buildTurns(events)[0]!.activity.items.filter((item) => item.kind === 'tool')
    ).toHaveLength(4)
    expect((await b.checkpoint())!.invocations).toHaveLength(4)
  })

  it.each([
    [
      'a removed tool',
      (b: Awaited<ReturnType<typeof browser>>) =>
        (b.config.tools = ['create_project', 'build_guide']),
      'mcp:designs:add_parts is not available now'
    ],
    [
      'a changed server address',
      (b: Awaited<ReturnType<typeof browser>>) =>
        (b.config.server = { ...SERVER, url: 'https://elsewhere.test/mcp' }),
      'different source or server address'
    ],
    [
      'different access',
      (b: Awaited<ReturnType<typeof browser>>) => (b.config.token = 'token-b'),
      'signed in differently'
    ]
  ])(
    'blocks Resume after %s (retryable), then resumes once it is restored',
    async (_name, change, reason) => {
      const w = world()
      const b = await browser(w)
      await failAfterGuide(w, b)
      const original = { ...b.config }
      change(b)
      const before = w.decisions.length

      await b.run({ resume: true })
      expect(w.decisions).toHaveLength(before)
      expect(notices(await b.events())[0]).toContain(reason)
      expect((await b.checkpoint())!.blocked?.retryable).toBe(true)

      Object.assign(b.config, original)
      await b.run({ resume: true })
      expect(await b.checkpoint()).toBeUndefined()
      expect(creations(w)).toBe(1)
      expect(w.mcpCalls).toHaveLength(4)
    }
  )

  it('refuses an incompatible checkpoint version and keeps it as evidence', async () => {
    const w = world()
    const b = await browser(w)
    await failAfterGuide(w, b)
    const saved = (await b.checkpoint())!
    await b.store().put({ ...saved, version: 2 } as unknown as RunCheckpoint)
    const before = w.decisions.length

    await b.run({ resume: true })
    expect(w.decisions).toHaveLength(before)
    expect(notices(await b.events())[0]).toContain('written by a different version')
    expect(((await b.checkpoint()) as unknown as { version: number }).version).toBe(2)
  })

  it('never replays a mutation whose response was lost to a reload: uncertain blocks without a reconciler, and a reconciler can confirm it', async () => {
    for (const reconcile of [false, true]) {
      const w = world()
      const b = await browser(
        w,
        reconcile
          ? {
              recovery: {
                reconcile: ({ call }) => {
                  expect(call).toMatchObject({
                    toolId: 'mcp:designs:add_parts',
                    source: { kind: 'mcp', groupId: 'designs' }
                  })
                  return Promise.resolve({
                    status: 'completed' as const,
                    output: {
                      serverName: 'Designs',
                      toolName: 'add_parts',
                      text: '{"accepted":true}',
                      raw: { content: [{ type: 'text', text: '{"accepted":true}' }] },
                      isError: false
                    }
                  })
                }
              }
            }
          : {}
      )
      w.hangTools.add('add_parts')
      // The page dies while add_parts is in flight: no finally, no cleanup.
      b.start().promise.catch(() => {})
      await until(async () => (await b.checkpoint())?.inFlight?.toolId === 'mcp:designs:add_parts')

      b.reload()
      w.hangTools.clear()
      await b.run({ resume: true })
      expect(w.mcpCalls.filter((call) => call.tool === 'add_parts')).toHaveLength(1)
      expect(creations(w)).toBe(1)
      if (reconcile) {
        expect(await b.checkpoint()).toBeUndefined()
        expect(mutations(w)).toEqual(['create_project', 'add_parts', 'add_links'])
      } else {
        expect(notices(await b.events())[0]).toContain(
          'The last call (mcp:designs:add_parts) was sent, but its result never arrived'
        )
        expect((await b.checkpoint())!.blocked?.retryable).toBe(false)
      }
    }
  })

  it('blocks a Resume after a lost create_project response rather than creating a second project', async () => {
    const w = world()
    const b = await browser(w)
    w.hangTools.add('create_project')
    b.start().promise.catch(() => {})
    await until(async () => (await b.checkpoint())?.inFlight !== undefined)
    b.reload()
    w.hangTools.clear()

    await b.run({ resume: true })
    expect(creations(w)).toBe(1)
    expect(w.projects.size).toBe(1)
    expect(notices(await b.events())[0]).toContain('(mcp:designs:create_project) was sent')
  })

  it('does not auto-resume a cancelled run; an explicit Resume later continues it', async () => {
    const w = world()
    const b = await browser(w)
    w.faults.set(3, 'hang')
    const controller = new AbortController()
    const first = b.start({ signal: controller.signal })
    await until(() => Promise.resolve(w.decisions.length === 3))
    controller.abort()
    await drive(first.promise)
    await drive(new Promise((resolve) => setTimeout(resolve, 600_000)))

    expect(w.decisions).toHaveLength(3)
    expect(await b.checkpoint()).toMatchObject({ state: 'stopped', stop: 'cancelled' })
    expect((await b.checkpoint())!.invocations).toHaveLength(2)

    await b.run({ resume: true })
    expect(await b.checkpoint()).toBeUndefined()
    expect(mutations(w)).toEqual(['create_project', 'add_parts', 'add_links'])
  })

  it('keeps progress through a prolonged cooldown, and the resumed run recovers an ordinary 429', async () => {
    const w = world()
    const b = await browser(w)
    w.faults.set(2, { rateLimitMs: 400_000 })
    await b.run()
    const events = await b.events()
    expect(
      events.some(
        (event) => event.type === 'rate.limit.cancelled' && event.payload.reason === 'too_long'
      )
    ).toBe(true)
    expect(await b.checkpoint()).toMatchObject({ state: 'stopped', stop: 'rate_limited' })
    expect(w.mcpCalls).toHaveLength(1)

    await drive(new Promise((resolve) => setTimeout(resolve, 500_000)))
    b.reload()
    w.faults.set(w.decisions.length + 1, { rateLimitMs: 2_000 })
    await b.run({ resume: true })

    const resumed = await b.events()
    expect(resumed.filter((event) => event.type === 'rate.limit.recovered')).toHaveLength(1)
    expect(creations(w)).toBe(1)
    expect(mutations(w)).toEqual(['create_project', 'add_parts', 'add_links'])
    expect(await b.checkpoint()).toBeUndefined()
  })

  it('a new Send supersedes saved progress: it starts fresh and is never a Resume', async () => {
    const w = world()
    const b = await browser(w)
    await failAfterGuide(w, b)
    const before = w.decisions.length

    w.faults.set(before + 1, 'hang')
    await b.run({ prompt: 'Something else.' })
    const fresh = JSON.parse(w.decisions[before]!) as { messages: WireMessage[] }
    expect(fresh.messages.filter((message) => message.role === 'tool')).toHaveLength(0)
    expect(await b.checkpoint()).toBeUndefined()

    // The old turn's progress cannot be resumed into the new turn.
    await b.run({ resume: true })
    expect(notices(await b.events()).at(-1)).toBe(
      'Resume stopped: there is no saved progress for this turn.'
    )
  })

  it('tells the truth when progress cannot be saved', async () => {
    // put fails, delete succeeds: no record exists, so the call may proceed,
    // and the partial answer says the run cannot be resumed.
    {
      const w = world()
      const b = await browser(w)
      vi.spyOn(b.store(), 'put').mockRejectedValue(new Error('QuotaExceededError'))
      await failAfterGuide(w, b)
      expect(w.mcpCalls).toHaveLength(4)
      expect(await b.checkpoint()).toBeUndefined()
      expect(answers(await b.events()).at(-1)).toContain('could not be saved in this browser')
    }
    // put and delete both fail after the first call: the stale record still
    // truthfully says "one call done", so the next call is NOT made.
    {
      const w = world()
      const b = await browser(w)
      const store = b.store()
      const put = store.put.bind(store)
      let writes = 0
      vi.spyOn(store, 'put').mockImplementation(async (record) => {
        writes += 1
        if (writes > 2) throw new Error('storage gone')
        await put(record)
      })
      vi.spyOn(store, 'delete').mockRejectedValue(new Error('storage gone'))
      await b.run()
      expect(w.mcpCalls.map((call) => call.tool)).toEqual(['create_project'])
      const events = await b.events()
      expect(
        events.some(
          (event) =>
            event.type === 'error' && event.payload.message.includes('next tool call was not made')
        )
      ).toBe(true)
      expect((await b.checkpoint())!.invocations).toHaveLength(1)
    }
  })
})
