import { describe, expect, it } from 'vitest'
import { githubModelEntrySchema } from '@tinytinkerer/contracts'
import type {
  ContentDocument,
  ChatEvent,
  McpDiscoveryResult,
  McpServerConfig
} from '@tinytinkerer/contracts'
import {
  activeCooldown,
  applyRateLimitEvent,
  buildConversationHistory,
  buildTurns,
  canSendPrompt,
  cooldownKeyForProvider,
  DEFAULT_MODEL,
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_MODELS_BY_PROVIDER,
  defaultChatState,
  defaultSettingsState,
  inferPlan,
  initializeChatState,
  loadCooldown,
  loadGitHubModelsCatalog,
  loadSupportedEmbeddingModels,
  loadSettingsState,
  normalizeModelProvider,
  normalizeSelectedModel,
  normalizeSelectedModelForProvider,
  persistBooleanPreference,
  persistOpenRouterApiKey,
  persistSelectedModelProvider,
  resolveActivePluginIds,
  SETTINGS_KEYS
} from '../src/index.js'

const event = <T extends ChatEvent['type']>(
  type: T,
  payload: Extract<ChatEvent, { type: T }>['payload']
): Extract<ChatEvent, { type: T }> =>
  ({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    payload
  }) as Extract<ChatEvent, { type: T }>

const assistantContent = (source: string): ContentDocument => ({
  nodes:
    source.trim().length > 0
      ? [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: source }]
          }
        ]
      : []
})

describe('app-core helpers', () => {
  it('infers search plans', () => {
    expect(
      inferPlan('latest ai news').steps.some((step) => step.id === 'search')
    ).toBe(true)
  })

  it('falls back to the default model for null/empty values', () => {
    expect(normalizeSelectedModel(null)).toBe(DEFAULT_MODEL)
    expect(normalizeSelectedModel(undefined)).toBe(DEFAULT_MODEL)
    expect(normalizeSelectedModel('')).toBe(DEFAULT_MODEL)
    expect(normalizeSelectedModel('   ')).toBe(DEFAULT_MODEL)
  })

  it('preserves any non-empty model id including dynamic models', () => {
    expect(normalizeSelectedModel('openai/gpt-4o')).toBe('openai/gpt-4o')
    expect(normalizeSelectedModel('meta/llama-4-scout-17b-16e-instruct')).toBe(
      'meta/llama-4-scout-17b-16e-instruct'
    )
  })

  it('defaults model provider to GitHub and normalizes provider-specific models', () => {
    expect(DEFAULT_MODEL_PROVIDER).toBe('github')
    expect(normalizeModelProvider(undefined)).toBe('github')
    expect(normalizeModelProvider('openrouter')).toBe('openrouter')
    expect(normalizeSelectedModelForProvider('openrouter', '')).toBe(
      DEFAULT_MODELS_BY_PROVIDER.openrouter
    )
  })

  it('keeps a checked-in GitHub Models catalog with chat and embedding models', async () => {
    const catalog = await loadGitHubModelsCatalog()
    const embeddingModels = await loadSupportedEmbeddingModels()
    expect(() =>
      catalog.forEach((model) => githubModelEntrySchema.parse(model))
    ).not.toThrow()
    expect(DEFAULT_MODEL).toBe('openai/gpt-5')
    expect(catalog.some((model) => model.id === DEFAULT_MODEL)).toBe(true)
    expect(
      embeddingModels.some((model) => model.id.includes('/text-embedding'))
    ).toBe(true)
  })

  it('builds conversation history from completed turns only', () => {
    expect(
      buildConversationHistory([
        event('user.message', { text: 'hello' }),
        event('assistant.done', {
          source: 'hi',
          content: assistantContent('hi')
        }),
        event('user.message', { text: 'broken' }),
        event('error', { message: 'oops' })
      ])
    ).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' }
    ])
  })

  it('projects turns with per-turn activity entries', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hello' }),
      event('agent.step.started', {
        stepId: 'plan',
        kind: 'plan',
        title: 'Created 1-step plan'
      }),
      event('agent.step.started', {
        stepId: 'step-1',
        parentStepId: 'plan',
        kind: 'plan-step',
        title: 'Search web'
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const turns = buildTurns(events)
    expect(turns).toHaveLength(1)
    const labels =
      turns[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
    expect(labels).toHaveLength(2)
  })

  it('coalesces tool start/completed into a single activity item and captures reasoning', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hello' }),
      event('reasoning.chunk', { source: 'm', text: 'thinking…' }),
      event('reasoning.done', { source: 'm', text: 'thinking… done' }),
      event('agent.tool.started', {
        stepId: 'act-1',
        toolId: 'web-search',
        input: { query: 'hello' }
      }),
      event('agent.tool.completed', {
        stepId: 'act-1',
        toolId: 'web-search',
        output: { query: 'hello', results: [] }
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const activity = buildTurns(events)[0]?.activity
    expect(activity?.reasoningText).toBe('thinking… done')
    const tools = activity?.items.filter((item) => item.kind === 'tool') ?? []
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      toolId: 'web-search',
      status: 'completed'
    })
    expect(
      activity?.items.filter((item) => item.kind === 'reasoning')
    ).toHaveLength(1)
  })

  it('captures step hierarchy (stepId, parentId, kind) for nested agent steps', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', {
        stepId: 'plan',
        kind: 'plan',
        title: 'Created 1-step plan'
      }),
      event('agent.step.started', {
        stepId: 's1',
        parentStepId: 'plan',
        kind: 'plan-step',
        title: 'Search'
      }),
      event('agent.tool.started', {
        stepId: 't1',
        parentStepId: 's1',
        toolId: 'web-search',
        input: { query: 'x' }
      }),
      event('agent.tool.completed', {
        stepId: 't1',
        toolId: 'web-search',
        output: {}
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const items = buildTurns(events)[0]?.activity.items ?? []
    expect(
      items.find((item) => item.kind === 'label' && item.stepId === 's1')
    ).toMatchObject({
      parentId: 'plan',
      stepKind: 'plan-step'
    })
    expect(items.find((item) => item.kind === 'tool')).toMatchObject({
      stepId: 't1',
      parentId: 's1',
      status: 'completed'
    })
  })

  it('streams a thought into the matching think step label and does not duplicate it', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', {
        stepId: 'th1',
        kind: 'think',
        title: 'Thinking…'
      }),
      event('agent.step.delta', { stepId: 'th1', text: 'Let me search' }),
      event('agent.step.delta', {
        stepId: 'th1',
        text: 'Let me search the docs'
      }),
      event('agent.step.completed', {
        stepId: 'th1',
        summary: 'Let me search the docs'
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const labels =
      buildTurns(events)[0]?.activity.items.filter(
        (item) => item.kind === 'label'
      ) ?? []
    expect(labels).toHaveLength(1)
    expect(labels[0]).toMatchObject({
      label: 'Let me search the docs',
      stepKind: 'think'
    })
  })

  it('appends a separate observation label for a non-think step completion', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', {
        stepId: 'a1',
        kind: 'act',
        title: 'Using web-search'
      }),
      event('agent.step.completed', {
        stepId: 'a1',
        summary: 'web-search: {"r":1}'
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const labels =
      buildTurns(events)[0]?.activity.items.filter(
        (item) => item.kind === 'label'
      ) ?? []
    expect(labels).toHaveLength(2)
    expect(
      labels.some(
        (item) => item.kind === 'label' && item.label.startsWith('web-search')
      )
    ).toBe(true)
  })

  it('keeps one turn when rate-limit waiting later completes', () => {
    const turns = buildTurns([
      event('user.message', { text: 'latest news' }),
      event('rate.limit.waiting', {
        retryAfterMs: 1_000,
        retryAt: new Date(Date.now() + 1_000).toISOString(),
        message: 'Rate limited for a moment.',
        autoRetry: true
      }),
      event('assistant.done', {
        source: 'Here is the latest update.',
        content: assistantContent('Here is the latest update.')
      })
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]?.id).toEqual(expect.any(String))
    expect(turns[0]).toMatchObject({
      userText: 'latest news',
      assistantSource: 'Here is the latest update.',
      notice: {
        kind: 'rate-limit',
        message: 'Rate limited for a moment.',
        level: 'warning'
      }
    })
  })

  it('keeps one turn when a system notice later completes', () => {
    const turns = buildTurns([
      event('user.message', { text: 'hello' }),
      event('system', { message: 'Using cached context.', level: 'info' }),
      event('assistant.done', {
        source: 'Hi there.',
        content: assistantContent('Hi there.')
      })
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]?.id).toEqual(expect.any(String))
    expect(turns[0]).toMatchObject({
      userText: 'hello',
      assistantSource: 'Hi there.',
      notice: {
        kind: 'system',
        message: 'Using cached context.',
        level: 'info'
      }
    })
  })

  it('keeps assistantContent null when assistant.done source is empty', () => {
    const turns = buildTurns([
      event('user.message', { text: 'hello' }),
      event('assistant.done', { source: '   ', content: assistantContent('') })
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      userText: 'hello',
      assistantSource: '   ',
      assistantContent: null,
      isStreaming: false
    })
  })

  it('coerces malformed persisted assistant content (e.g. legacy string payloads) to null', () => {
    // Simulate a record that survived the v2 IndexedDB migration with a raw
    // markdown string in payload.content. The renderer requires a structured
    // ContentDocument; the projection should drop the bad shape rather than
    // pass it through and crash the chat surface.
    const malformed = [
      {
        id: 'evt-user',
        timestamp: new Date().toISOString(),
        type: 'user.message',
        payload: { text: 'hello' }
      },
      {
        id: 'evt-done',
        timestamp: new Date().toISOString(),
        type: 'assistant.done',
        payload: {
          source: 'hi there',
          content: 'hi there' as unknown as ContentDocument
        }
      }
    ] as ChatEvent[]

    const turns = buildTurns(malformed)
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      userText: 'hello',
      assistantContent: null
    })
  })

  it('drops expired cooldowns', () => {
    expect(
      activeCooldown(new Date(Date.now() - 1_000).toISOString())
    ).toBeUndefined()
  })

  it('does not attach activity to a turn without a preceding user.message', () => {
    const turns = buildTurns([
      event('agent.step.started', {
        stepId: 'plan',
        kind: 'plan',
        title: 'Created 0-step plan'
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]?.activity.items).toEqual([])
  })

  it('agent.step.completed with empty summary does not appear in activity', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hello' }),
      event('agent.step.completed', { stepId: 'step-1' }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]
    const labels =
      buildTurns(events)[0]?.activity.items.filter(
        (item) => item.kind === 'label'
      ) ?? []
    expect(labels).toHaveLength(0)
  })

  it('drops malformed persisted MCP servers during settings hydration', async () => {
    const validServer: McpServerConfig = {
      id: 'server-1',
      name: 'Weather Server',
      url: 'https://mcp.example.com/mcp',
      enabled: true
    }
    const state = await loadSettingsState({
      get: (key) =>
        key === 'settings_mcp_servers'
          ? Promise.resolve(
              JSON.stringify([validServer, { id: 'broken', enabled: 'yes' }])
            )
          : Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.mcpServers).toEqual([validServer])
  })

  it('defaults plugin activation to an empty map when no preference is stored', async () => {
    const state = await loadSettingsState({
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.pluginActivation).toEqual({})
    expect(defaultSettingsState().pluginActivation).toEqual({})
  })

  it('hydrates plugin activation from the stored preference key', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.pluginActivation
            ? JSON.stringify({ 'send-feedback': true })
            : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.pluginActivation).toEqual({ 'send-feedback': true })
  })

  it('ignores malformed plugin activation JSON', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.pluginActivation ? '{ not json' : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.pluginActivation).toEqual({})
  })

  it('resolveActivePluginIds returns only enabled plugin ids', () => {
    expect(
      resolveActivePluginIds({ 'send-feedback': true, other: false })
    ).toEqual(new Set(['send-feedback']))
  })

  it('defaults reasoning & activity to false when no preference is stored', async () => {
    const state = await loadSettingsState({
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.showReasoningActivity).toBe(false)
    expect(defaultSettingsState().showReasoningActivity).toBe(false)
  })

  it('defaults Web Speech API voice input to false when no preference is stored', async () => {
    const state = await loadSettingsState({
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.webSpeechEnabled).toBe(false)
    expect(defaultSettingsState().webSpeechEnabled).toBe(false)
  })

  it('hydrates Web Speech API voice input from the stored preference key', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.webSpeechEnabled ? 'true' : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.webSpeechEnabled).toBe(true)
  })

  it('hydrates model provider, per-provider selected models, and OpenRouter API key', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.selectedModelProvider
            ? 'openrouter'
            : key === SETTINGS_KEYS.selectedModelsByProvider
              ? JSON.stringify({
                  github: 'openai/gpt-5',
                  openrouter: 'anthropic/claude-3.5-sonnet'
                })
              : key === SETTINGS_KEYS.openRouterApiKey
                ? 'sk-or-v1-test'
                : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.selectedModelProvider).toBe('openrouter')
    expect(state.selectedModel).toBe('anthropic/claude-3.5-sonnet')
    expect(state.openRouterApiKey).toBe('sk-or-v1-test')
  })

  it('persists model provider and OpenRouter API key', async () => {
    const writes: Array<{ key: string; value: string }> = []
    const preferences = {
      get: () => Promise.resolve(undefined),
      set: (key: string, value: string) => {
        writes.push({ key, value })
        return Promise.resolve()
      }
    }

    await persistSelectedModelProvider(preferences, 'openrouter')
    await persistOpenRouterApiKey(preferences, '  sk-or-v1-test  ')

    expect(writes).toEqual([
      { key: SETTINGS_KEYS.selectedModelProvider, value: 'openrouter' },
      { key: SETTINGS_KEYS.openRouterApiKey, value: 'sk-or-v1-test' }
    ])
  })

  it('hydrates reasoning & activity from the stored preference key', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.showReasoningActivity ? 'true' : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.showReasoningActivity).toBe(true)
  })

  it('migrates reasoning & activity from either legacy toggle when the new key is unset', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === 'settings_show_tool_activity' ? 'true' : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.showReasoningActivity).toBe(true)
  })

  it('defaults showCodeBlockFullscreenButton to true when no preference is stored', async () => {
    const state = await loadSettingsState({
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.showCodeBlockFullscreenButton).toBe(true)
    expect(defaultSettingsState().showCodeBlockFullscreenButton).toBe(true)
  })

  it('hydrates showCodeBlockFullscreenButton from the stored preference key', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.showCodeBlockFullscreenButton
            ? 'false'
            : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.showCodeBlockFullscreenButton).toBe(false)
  })

  it('persists showCodeBlockFullscreenButton via the shared boolean writer', async () => {
    const writes: Array<{ key: string; value: string }> = []
    await persistBooleanPreference(
      {
        get: () => Promise.resolve(undefined),
        set: (key, value) => {
          writes.push({ key, value })
          return Promise.resolve()
        }
      },
      SETTINGS_KEYS.showCodeBlockFullscreenButton,
      false
    )

    expect(writes).toEqual([
      { key: 'settings_show_code_block_fullscreen_button', value: 'false' }
    ])
  })

  it('drops malformed persisted MCP discovery entries during settings hydration', async () => {
    const validDiscovery: McpDiscoveryResult = {
      serverId: 'server-1',
      serverName: 'Weather Server',
      tools: [
        { toolName: 'get_weather', description: 'Get weather', inputSchema: {} }
      ],
      syncedAt: new Date().toISOString()
    }
    const state = await loadSettingsState({
      get: (key) =>
        key === 'settings_mcp_discovery'
          ? Promise.resolve(
              JSON.stringify({
                'server-1': validDiscovery,
                broken: {
                  serverId: 'broken',
                  serverName: 42,
                  tools: [],
                  syncedAt: 'now'
                }
              })
            )
          : Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.mcpDiscovery).toEqual({ 'server-1': validDiscovery })
  })

  describe('canSendPrompt', () => {
    it('returns false when conversationId is absent', () => {
      expect(
        canSendPrompt({ ...defaultChatState(), conversationId: undefined })
      ).toBe(false)
    })

    it('returns false when isRunning is true', () => {
      expect(
        canSendPrompt({
          ...defaultChatState(),
          conversationId: 'id',
          isRunning: true
        })
      ).toBe(false)
    })

    it('returns false when cooldown is active', () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      expect(
        canSendPrompt({
          ...defaultChatState(),
          conversationId: 'id',
          cooldownUntil: future
        })
      ).toBe(false)
    })

    it('returns true when cooldown has expired', () => {
      const past = new Date(Date.now() - 1_000).toISOString()
      expect(
        canSendPrompt({
          ...defaultChatState(),
          conversationId: 'id',
          cooldownUntil: past
        })
      ).toBe(true)
    })

    it('returns true when all conditions are clear', () => {
      expect(
        canSendPrompt({ ...defaultChatState(), conversationId: 'id' })
      ).toBe(true)
    })
  })
})

describe('per-provider rate-limit cooldown (issue #146)', () => {
  const makePreferences = (initial: Record<string, string> = {}) => {
    const store = new Map<string, string>(Object.entries(initial))
    return {
      get: (key: string) => Promise.resolve(store.get(key)),
      set: (key: string, value: string) => {
        store.set(key, value)
        return Promise.resolve()
      }
    }
  }

  const conversation = { id: 'c1', title: '', createdAt: '', updatedAt: '' }
  const makeConversations = () => ({
    getLatestConversation: () => Promise.resolve(conversation),
    createConversation: () => Promise.resolve(conversation),
    loadConversationEvents: () => Promise.resolve([]),
    appendEvent: () => Promise.resolve(),
    clearConversationEvents: () => Promise.resolve()
  })

  const waitingEvent = (retryAt: string) =>
    event('rate.limit.waiting', {
      retryAfterMs: 60_000,
      retryAt,
      message: 'rate limited',
      autoRetry: false
    })

  it('derives a distinct cooldown key per provider', () => {
    expect(cooldownKeyForProvider('github')).not.toBe(
      cooldownKeyForProvider('openrouter')
    )
    expect(cooldownKeyForProvider('github')).toContain('github')
  })

  it('records a 429 cooldown only under the active provider', async () => {
    const prefs = makePreferences()
    const future = new Date(Date.now() + 60_000).toISOString()

    const result = await applyRateLimitEvent(waitingEvent(future), prefs, 'github')

    expect(result?.cooldownUntil).toBe(future)
    expect(await loadCooldown(prefs, 'github')).toBe(future)
    // A different provider draws on a separate quota — it must stay sendable.
    expect(await loadCooldown(prefs, 'openrouter')).toBeUndefined()
  })

  it('clears only the active provider on recovery', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const prefs = makePreferences({
      [cooldownKeyForProvider('github')]: future,
      [cooldownKeyForProvider('openrouter')]: future
    })

    await applyRateLimitEvent(
      event('rate.limit.recovered', { retryAt: future }),
      prefs,
      'github'
    )

    expect(await loadCooldown(prefs, 'github')).toBeUndefined()
    expect(await loadCooldown(prefs, 'openrouter')).toBe(future)
  })

  it('initializeChatState loads only the requested provider’s cooldown', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const prefs = makePreferences({
      [cooldownKeyForProvider('openrouter')]: future
    })
    const conversations = makeConversations()

    const githubState = await initializeChatState(conversations, prefs, 'github')
    expect(githubState.cooldownUntil).toBeUndefined()

    const openrouterState = await initializeChatState(
      conversations,
      prefs,
      'openrouter'
    )
    expect(openrouterState.cooldownUntil).toBe(future)
  })
})
