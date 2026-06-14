import { describe, expect, it } from 'vitest'
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
  DEFAULT_MODEL,
  DEFAULT_MODEL_PROVIDER,
  defaultChatState,
  defaultSettingsState,
  inferPlan,
  initializeChatState,
  LITELLM_DEPLOYMENT_DEFAULT,
  loadCooldown,
  loadSettingsState,
  normalizeLiteLLMBaseUrl,
  normalizeSelectedModel,
  persistBooleanPreference,
  persistLiteLLMBaseUrl,
  persistSelectedModel,
  rateLimitCooldownKey,
  isPluginEnabled,
  resolveActivePluginIds,
  SETTINGS_KEYS,
  validateLiteLLMBaseUrl
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

  it('uses LiteLLM as the sole model provider and normalizes the base URL', () => {
    expect(DEFAULT_MODEL_PROVIDER).toBe('litellm')
    expect(DEFAULT_MODEL).toBe('chatgpt/gpt-5.4')
    expect(normalizeLiteLLMBaseUrl('https://litellm.example.com')).toBe(
      'https://litellm.example.com/'
    )
    // An invalid value normalizes to the deployment-default sentinel, never
    // to a concrete URL — the client must not assert a default (issue #179).
    expect(normalizeLiteLLMBaseUrl('http://litellm.example.com')).toBe(
      LITELLM_DEPLOYMENT_DEFAULT
    )
  })

  it('validates the base URL with the same rules as the edge instead of silently stripping', () => {
    expect(validateLiteLLMBaseUrl('https://litellm.example.com')).toEqual({
      ok: true,
      url: 'https://litellm.example.com/'
    })
    // Empty means "use the deployment default" — kept as the sentinel so
    // requests omit the field and the edge resolves its configured URL.
    expect(validateLiteLLMBaseUrl('')).toEqual({
      ok: true,
      url: LITELLM_DEPLOYMENT_DEFAULT
    })
    expect(validateLiteLLMBaseUrl('not a url').ok).toBe(false)
    expect(validateLiteLLMBaseUrl('http://litellm.example.com').ok).toBe(false)
    // The edge REJECTS credentials/query/fragment; the client used to strip
    // them, so the two could disagree about the same input (issue #179).
    expect(validateLiteLLMBaseUrl('https://user:pw@litellm.example.com').ok).toBe(false)
    expect(validateLiteLLMBaseUrl('https://litellm.example.com/?key=1').ok).toBe(false)
    expect(validateLiteLLMBaseUrl('https://litellm.example.com/#frag').ok).toBe(false)
    // …and the load-path normalizer maps those rejects to the sentinel.
    expect(normalizeLiteLLMBaseUrl('https://litellm.example.com/?key=1')).toBe(
      LITELLM_DEPLOYMENT_DEFAULT
    )
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

  it('isPluginEnabled honors stored choice, then manifest default', () => {
    // No stored entry: the manifest default decides.
    expect(isPluginEnabled({}, { id: 'web-search', defaultEnabled: true })).toBe(true)
    expect(isPluginEnabled({}, { id: 'feedback' })).toBe(false)
    // An explicit user choice always wins over the default.
    expect(
      isPluginEnabled({ 'web-search': false }, { id: 'web-search', defaultEnabled: true })
    ).toBe(false)
    expect(isPluginEnabled({ feedback: true }, { id: 'feedback' })).toBe(true)
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

  it('reads the stored selected model', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.selectedModel ? 'openai/gpt-4o' : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.selectedModel).toBe('openai/gpt-4o')
  })

  it('persists the selected model and LiteLLM base URL', async () => {
    const writes: Array<{ key: string; value: string }> = []
    const preferences = {
      get: () => Promise.resolve(undefined),
      set: (key: string, value: string) => {
        writes.push({ key, value })
        return Promise.resolve()
      }
    }

    await persistSelectedModel(preferences, 'openai/gpt-4.1-mini')
    await persistLiteLLMBaseUrl(preferences, 'https://litellm.example.com')

    expect(writes).toEqual([
      { key: SETTINGS_KEYS.selectedModel, value: 'openai/gpt-4.1-mini' },
      {
        key: SETTINGS_KEYS.litellmBaseUrl,
        value: 'https://litellm.example.com/'
      }
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

  it('defaults showReasoningActivity to false when no preference is stored', async () => {
    const state = await loadSettingsState({
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.showReasoningActivity).toBe(false)
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

describe('rate-limit cooldown', () => {
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

  it('records a 429 cooldown under the litellm-scoped key', async () => {
    const prefs = makePreferences()
    const future = new Date(Date.now() + 60_000).toISOString()

    const result = await applyRateLimitEvent(waitingEvent(future), prefs)

    expect(result?.cooldownUntil).toBe(future)
    expect(rateLimitCooldownKey()).toBe('rate_limit_cooldown_until:litellm')
    // The deployment-default sentinel (empty string) scopes to the same key
    // as "no base URL": an unset Settings value and an omitted argument must
    // share one cooldown bucket.
    expect(rateLimitCooldownKey(LITELLM_DEPLOYMENT_DEFAULT)).toBe(
      'rate_limit_cooldown_until:litellm'
    )
    expect(await loadCooldown(prefs)).toBe(future)
  })

  it('scopes the cooldown per LiteLLM deployment, mirroring the edge backoff (issue #179)', async () => {
    const prefs = makePreferences()
    const future = new Date(Date.now() + 60_000).toISOString()
    const deploymentA = 'https://litellm.labs.lair.nntin.xyz/'
    const deploymentB = 'https://litellm.example.com/'

    expect(rateLimitCooldownKey(deploymentA)).toBe(
      `rate_limit_cooldown_until:litellm:${deploymentA}`
    )

    await applyRateLimitEvent(waitingEvent(future), prefs, deploymentA)

    // Switching base URLs in Settings must not carry the old deployment's
    // cooldown over.
    expect(await loadCooldown(prefs, deploymentA)).toBe(future)
    expect(await loadCooldown(prefs, deploymentB)).toBeUndefined()
  })

  it('clears the cooldown on recovery', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const prefs = makePreferences({
      [rateLimitCooldownKey()]: future
    })

    await applyRateLimitEvent(
      event('rate.limit.recovered', { retryAt: future }),
      prefs
    )

    expect(await loadCooldown(prefs)).toBeUndefined()
  })

  it('initializeChatState loads the stored cooldown and ignores legacy provider-scoped keys', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const baseUrl = 'https://litellm.example.com/'
    const prefs = makePreferences({
      [rateLimitCooldownKey(baseUrl)]: future,
      // The unscoped litellm key now belongs to the deployment-default scope;
      // with an explicit base URL it is simply a different bucket. Values
      // written by the removed GitHub Models/OpenRouter providers are
      // orphaned and self-expire without migration.
      'rate_limit_cooldown_until:litellm': future,
      'rate_limit_cooldown_until:github': future,
      'rate_limit_cooldown_until:openrouter': future
    })
    const conversations = makeConversations()

    const state = await initializeChatState(conversations, prefs, baseUrl)
    expect(state.cooldownUntil).toBe(future)
  })
})
