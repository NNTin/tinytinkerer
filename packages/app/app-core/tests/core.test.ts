import { describe, expect, it } from 'vitest'
import { KEYWORD_PROMPT_SENTINEL } from '@tinytinkerer/contracts'
import type {
  ContentDocument,
  ChatEvent,
  McpDiscoveryResult,
  McpServerConfig
} from '@tinytinkerer/contracts'
import {
  activeCooldown,
  applyAppToolSelection,
  applyPluginToolSelection,
  applyRateLimitEvent,
  buildConversationHistory,
  buildTurns,
  canSendPrompt,
  compareEventOrder,
  DEFAULT_MODEL,
  DEFAULT_MODEL_PROVIDER,
  defaultChatState,
  defaultSettingsState,
  inferPlan,
  initializeChatState,
  isPluginToolEnabled,
  LITELLM_DEPLOYMENT_DEFAULT,
  loadCooldown,
  loadSettingsState,
  normalizeLiteLLMBaseUrl,
  normalizeSelectedModel,
  persistBooleanPreference,
  persistLiteLLMBaseUrl,
  persistAppToolDisablement,
  persistPluginToolDisablement,
  persistSelectedModel,
  rateLimitCooldownKey,
  isPluginEnabled,
  reconcilePluginToolDisablement,
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
  // A web-search-shaped fallback tool: the keyword step that used to be hard-coded
  // in inferPlan now travels on the tool descriptor (KeywordPlannerStep).
  const searchTool = {
    id: 'web-search',
    keywordPlannerStep: {
      keywords: ['latest', 'news', 'search'],
      stepId: 'search',
      summary: 'Collect current references from web search',
      inputTemplate: { query: KEYWORD_PROMPT_SENTINEL, maxResults: 5 }
    }
  }

  it('proposes a keyword step when a matching tool descriptor is supplied', () => {
    const plan = inferPlan('latest ai news', [searchTool])
    const search = plan.steps.find((step) => step.id === 'search')
    expect(search).toBeDefined()
    // The sentinel is replaced with the user prompt; non-sentinel values
    // (maxResults: 5) pass through unchanged.
    expect(search?.toolCall).toEqual({
      toolId: 'web-search',
      input: { query: 'latest ai news', maxResults: 5 }
    })
  })

  it('substitutes only exact top-level sentinels (shallow), passing everything else through', () => {
    const tool = {
      id: 't',
      keywordPlannerStep: {
        keywords: ['go'],
        stepId: 'step',
        summary: 's',
        // A top-level non-sentinel string, a top-level sentinel, and a sentinel one
        // level deep (must NOT be substituted — substitution is shallow by contract).
        inputTemplate: {
          q: KEYWORD_PROMPT_SENTINEL,
          literal: 'keep me',
          nested: { inner: KEYWORD_PROMPT_SENTINEL }
        }
      }
    }
    const step = inferPlan('go now', [tool]).steps.find((s) => s.id === 'step')
    expect(step?.toolCall?.input).toEqual({
      q: 'go now',
      literal: 'keep me',
      nested: { inner: KEYWORD_PROMPT_SENTINEL }
    })
  })

  it('proposes no tool step when no descriptor matches (or none is supplied)', () => {
    expect(inferPlan('latest ai news').steps.some((step) => step.toolCall)).toBe(false)
    expect(inferPlan('say hello', [searchTool]).steps.some((step) => step.toolCall)).toBe(false)
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
    expect(normalizeLiteLLMBaseUrl('http://litellm.example.com')).toBe(LITELLM_DEPLOYMENT_DEFAULT)
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
    const labels = turns[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
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
    expect(activity?.items.filter((item) => item.kind === 'reasoning')).toHaveLength(1)
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
    expect(items.find((item) => item.kind === 'label' && item.stepId === 's1')).toMatchObject({
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
      buildTurns(events)[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
    expect(labels).toHaveLength(1)
    expect(labels[0]).toMatchObject({
      label: 'Let me search the docs',
      stepKind: 'think'
    })
  })

  it('folds a streaming decision kind onto the matching think step; prose is the label (action)', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', { stepId: 'th1', kind: 'think', title: 'Thinking…' }),
      event('agent.step.delta', { stepId: 'th1', text: 'Let me run the snippet' }),
      event('agent.step.completed', {
        stepId: 'th1',
        summary: 'Let me run the snippet',
        decisionKind: 'action'
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const labels =
      buildTurns(events)[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
    expect(labels).toHaveLength(1)
    // The model's prose IS the label; the decision kind drives the badge.
    expect(labels[0]).toMatchObject({
      label: 'Let me run the snippet',
      stepKind: 'think',
      decisionKind: 'action'
    })
  })

  it('clears the think label when a streaming action turn is silent (empty summary)', () => {
    // A native tool-call turn with no model prose: the runtime emits an empty
    // summary, which clears the live "Thinking…" so the step renders as just the
    // decision badge (issue #276 arch-review follow-up).
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', { stepId: 'th1', kind: 'think', title: 'Thinking…' }),
      event('agent.step.completed', { stepId: 'th1', summary: '', decisionKind: 'action' }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const label = buildTurns(events)[0]?.activity.items.find((item) => item.kind === 'label')
    expect(label).toMatchObject({ label: '', stepKind: 'think', decisionKind: 'action' })
  })

  it('carries a non-streaming decision kind from the started event; prose is the title (final)', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', {
        stepId: 'th1',
        kind: 'think',
        title: 'The sandbox returned its result; ready to answer.',
        decisionKind: 'final'
      }),
      event('agent.step.completed', { stepId: 'th1', decisionKind: 'final' }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const labels =
      buildTurns(events)[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
    expect(labels).toHaveLength(1)
    // The non-streaming path carries the prose as the title (the label).
    expect(labels[0]).toMatchObject({
      label: 'The sandbox returned its result; ready to answer.',
      stepKind: 'think',
      decisionKind: 'final'
    })
  })

  it('omits the decision kind when the model provides none (graceful degrade)', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', { stepId: 'th1', kind: 'think', title: 'Thinking…' }),
      event('agent.step.completed', { stepId: 'th1', summary: 'A bare thought' }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const label = buildTurns(events)[0]?.activity.items.find((item) => item.kind === 'label')
    expect(label).toMatchObject({ label: 'A bare thought', stepKind: 'think' })
    expect(label && 'decisionKind' in label ? label.decisionKind : undefined).toBeUndefined()
  })

  it('drops the redundant tool-result summary of an act step (issue #277)', () => {
    // An act step wraps a tool call; its completion summary is the serialized tool
    // result, which the nested tool item already renders via its ActivityView. So
    // only the "Using …" started label should remain — not a duplicate result line.
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', {
        stepId: 'a1',
        kind: 'act',
        title: 'Using run_javascript'
      }),
      event('agent.step.completed', {
        stepId: 'a1',
        summary: 'run_javascript: {"ok":true,"logs":[],"timedOut":false,"result":1}'
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const labels =
      buildTurns(events)[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
    expect(labels).toHaveLength(1)
    expect(labels[0]).toMatchObject({ label: 'Using run_javascript', stepKind: 'act' })
    expect(
      labels.some((item) => item.kind === 'label' && item.label.startsWith('run_javascript:'))
    ).toBe(false)
  })

  it('keeps the observation note of a non-act step completion', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hi' }),
      event('agent.step.started', {
        stepId: 'o1',
        kind: 'observe',
        title: 'Observing'
      }),
      event('agent.step.completed', {
        stepId: 'o1',
        summary: 'Noted the page has 3 headings'
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const labels =
      buildTurns(events)[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
    expect(
      labels.some((item) => item.kind === 'label' && item.label === 'Noted the page has 3 headings')
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
    expect(activeCooldown(new Date(Date.now() - 1_000).toISOString())).toBeUndefined()
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
      buildTurns(events)[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
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
          ? Promise.resolve(JSON.stringify([validServer, { id: 'broken', enabled: 'yes' }]))
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
        Promise.resolve(key === SETTINGS_KEYS.pluginActivation ? '{ not json' : undefined),
      set: () => Promise.resolve()
    })

    expect(state.pluginActivation).toEqual({})
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

  it('defaults plugin tool disablement to an empty map when no preference is stored', async () => {
    const state = await loadSettingsState({
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve()
    })

    expect(state.pluginDisabledTools).toEqual({})
    expect(defaultSettingsState().pluginDisabledTools).toEqual({})
  })

  it('hydrates plugin tool disablement from the stored preference key', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.pluginDisabledTools
            ? JSON.stringify({ 'web-search': ['deep_search'] })
            : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.pluginDisabledTools).toEqual({ 'web-search': ['deep_search'] })
  })

  it('ignores malformed plugin tool disablement JSON', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(key === SETTINGS_KEYS.pluginDisabledTools ? '{ not json' : undefined),
      set: () => Promise.resolve()
    })

    expect(state.pluginDisabledTools).toEqual({})
  })

  it('ignores plugin tool disablement of the wrong shape', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(
          key === SETTINGS_KEYS.pluginDisabledTools
            ? JSON.stringify({ 'web-search': 'deep_search' })
            : undefined
        ),
      set: () => Promise.resolve()
    })

    expect(state.pluginDisabledTools).toEqual({})
  })

  it('persistPluginToolDisablement round-trips through the preferences store', async () => {
    const stored = new Map<string, string>()
    const preferences = {
      get: (key: string) => Promise.resolve(stored.get(key)),
      set: (key: string, value: string) => {
        stored.set(key, value)
        return Promise.resolve()
      }
    }

    await persistPluginToolDisablement(preferences, { 'web-search': ['deep_search'] })
    const state = await loadSettingsState(preferences)

    expect(state.pluginDisabledTools).toEqual({ 'web-search': ['deep_search'] })
  })

  it('defaults app tool disablement to an empty map, and round-trips through the store', async () => {
    expect(defaultSettingsState().appToolDisablement).toEqual({})

    const stored = new Map<string, string>()
    const preferences = {
      get: (key: string) => Promise.resolve(stored.get(key)),
      set: (key: string, value: string) => {
        stored.set(key, value)
        return Promise.resolve()
      }
    }

    await persistAppToolDisablement(preferences, { canvas: ['draw'] })
    const state = await loadSettingsState(preferences)

    // App tool disablement is stored under its OWN key, independent of the plugin
    // denylist — so the plugin map stays empty.
    expect(state.appToolDisablement).toEqual({ canvas: ['draw'] })
    expect(state.pluginDisabledTools).toEqual({})
    expect(stored.has(SETTINGS_KEYS.appDisabledTools)).toBe(true)
  })

  it('isPluginToolEnabled treats absence — of the plugin key, the tool name, or both — as enabled', () => {
    expect(isPluginToolEnabled({}, 'web-search', 'deep_search')).toBe(true)
    expect(isPluginToolEnabled({ 'web-search': [] }, 'web-search', 'deep_search')).toBe(true)
    expect(isPluginToolEnabled({ 'web-search': ['other_tool'] }, 'web-search', 'deep_search')).toBe(
      true
    )
    expect(
      isPluginToolEnabled({ 'web-search': ['deep_search'] }, 'web-search', 'deep_search')
    ).toBe(false)
  })

  describe('applyPluginToolSelection', () => {
    const plugin = { id: 'web-search', toolIds: ['search', 'deep_search'] as const }

    it('stores the normalized array on a partial disable', () => {
      const result = applyPluginToolSelection({ activation: {}, disabledTools: {} }, plugin, [
        'deep_search'
      ])

      expect(result.disabledTools).toEqual({ 'web-search': ['deep_search'] })
      expect(result.activation).toEqual({})
      expect(result.pluginDisabled).toBe(false)
    })

    it('stores the normalized array ordered by plugin.toolIds, not the requested order', () => {
      const threeTool = { id: 'web-search', toolIds: ['a', 'b', 'c'] as const }
      const result = applyPluginToolSelection({ activation: {}, disabledTools: {} }, threeTool, [
        'c',
        'a'
      ])

      expect(result.disabledTools).toEqual({ 'web-search': ['a', 'c'] })
    })

    it('deletes the entry when the selection is empty (absence = all enabled)', () => {
      const result = applyPluginToolSelection(
        { activation: {}, disabledTools: { 'web-search': ['deep_search'] } },
        plugin,
        []
      )

      expect(result.disabledTools).toEqual({})
      expect(result.pluginDisabled).toBe(false)
    })

    it('disabling every tool deletes the entry and disables the plugin itself', () => {
      const result = applyPluginToolSelection(
        { activation: { 'web-search': true }, disabledTools: {} },
        plugin,
        ['search', 'deep_search']
      )

      expect(result.disabledTools).toEqual({})
      expect(result.activation).toEqual({ 'web-search': false })
      expect(result.pluginDisabled).toBe(true)
    })

    it('drops stale tool names that no longer exist on the plugin', () => {
      const result = applyPluginToolSelection({ activation: {}, disabledTools: {} }, plugin, [
        'deep_search',
        'removed_tool'
      ])

      expect(result.disabledTools).toEqual({ 'web-search': ['deep_search'] })
    })

    it('does not mutate the input activation/disabledTools objects', () => {
      const current = {
        activation: { 'web-search': true },
        disabledTools: { 'web-search': ['search'] }
      }

      applyPluginToolSelection(current, plugin, ['deep_search'])

      expect(current.activation).toEqual({ 'web-search': true })
      expect(current.disabledTools).toEqual({ 'web-search': ['search'] })
    })

    it('is a no-op for a plugin with zero declared tools, dropping any stale entry', () => {
      const zeroToolPlugin = { id: 'no-tools', toolIds: [] as const }
      const result = applyPluginToolSelection(
        { activation: { 'no-tools': true }, disabledTools: { 'no-tools': ['ghost'] } },
        zeroToolPlugin,
        ['ghost']
      )

      expect(result.disabledTools).toEqual({})
      expect(result.activation).toEqual({ 'no-tools': true })
      expect(result.pluginDisabled).toBe(false)
    })
  })

  // The app-tool counterpart to applyPluginToolSelection (issue #400 follow-up):
  // an app has no activation toggle, so disabling every tool is a persisted state
  // that keeps the group visible — NOT a signal to deactivate/remove it.
  describe('applyAppToolSelection', () => {
    const group = { id: 'canvas', toolIds: ['draw', 'search', 'inspect'] as const }

    it('stores the normalized array, ordered by group.toolIds, on a partial disable', () => {
      const result = applyAppToolSelection({}, group, ['inspect', 'draw'])
      expect(result).toEqual({ canvas: ['draw', 'inspect'] })
    })

    it('deletes the entry when nothing is disabled (absence = all enabled)', () => {
      const result = applyAppToolSelection({ canvas: ['draw'] }, group, [])
      expect(result).toEqual({})
    })

    it('KEEPS the full array when every tool is disabled — the group stays visible, no activation', () => {
      // This is the crux of the app-tool policy: unlike a plugin, all-disabled is a
      // stable stored state, so the group is never dropped from the picker.
      const result = applyAppToolSelection({}, group, ['draw', 'search', 'inspect'])
      expect(result).toEqual({ canvas: ['draw', 'search', 'inspect'] })
    })

    it('GCs stale tool names that no longer exist on the group', () => {
      const result = applyAppToolSelection({}, group, ['draw', 'removed_verb'])
      expect(result).toEqual({ canvas: ['draw'] })
    })

    it('is a no-op for a group with zero tools, dropping any stale entry', () => {
      const result = applyAppToolSelection({ empty: ['ghost'] }, { id: 'empty', toolIds: [] }, [
        'ghost'
      ])
      expect(result).toEqual({})
    })

    it('does not mutate the input map', () => {
      const current = { canvas: ['draw'] }
      applyAppToolSelection(current, group, ['search'])
      expect(current).toEqual({ canvas: ['draw'] })
    })
  })

  // Discovery-time reconciliation (issue #400 review, F2/F3): re-runs every
  // discovered plugin's STORED denylist entry through applyPluginToolSelection,
  // healing the "all tools disabled, plugin still enabled" ghost state a plugin
  // update can silently create between sessions.
  describe('reconcilePluginToolDisablement', () => {
    it('is a no-op (changed: false) when no stored entry needs healing', () => {
      const current = {
        activation: { 'web-search': true },
        disabledTools: { 'web-search': ['deep_search'] }
      }
      const result = reconcilePluginToolDisablement(current, [
        { id: 'web-search', toolIds: ['search', 'deep_search'] }
      ])

      expect(result.changed).toBe(false)
      expect(result.disabledTools).toEqual({ 'web-search': ['deep_search'] })
      expect(result.activation).toEqual({ 'web-search': true })
    })

    it('GCs a stale tool name left over from an older plugin version', () => {
      const current = {
        activation: { 'web-search': true },
        disabledTools: { 'web-search': ['deep_search', 'removed_tool'] }
      }
      const result = reconcilePluginToolDisablement(current, [
        { id: 'web-search', toolIds: ['search', 'deep_search'] }
      ])

      expect(result.changed).toBe(true)
      expect(result.disabledTools).toEqual({ 'web-search': ['deep_search'] })
    })

    it('heals an entry that now covers ALL current tools: flips activation off and clears it', () => {
      // A plugin update removed 'b' and 'c'; the stored entry (from when the
      // plugin had 3 tools) now covers the plugin's only remaining tool.
      const current = {
        activation: { multi: true },
        disabledTools: { multi: ['a'] }
      }
      const result = reconcilePluginToolDisablement(current, [{ id: 'multi', toolIds: ['a'] }])

      expect(result.changed).toBe(true)
      expect(result.disabledTools).toEqual({})
      expect(result.activation).toEqual({ multi: false })
    })

    it('leaves an entry for a plugin NOT in the discovered list untouched (may come back)', () => {
      const current = {
        activation: { gone: true },
        disabledTools: { gone: ['x'] }
      }
      const result = reconcilePluginToolDisablement(current, [{ id: 'other', toolIds: ['z'] }])

      expect(result.changed).toBe(false)
      expect(result.disabledTools).toEqual({ gone: ['x'] })
      expect(result.activation).toEqual({ gone: true })
    })

    it('does not mutate the input activation/disabledTools objects', () => {
      const current = {
        activation: { multi: true },
        disabledTools: { multi: ['a'] }
      }
      reconcilePluginToolDisablement(current, [{ id: 'multi', toolIds: ['a'] }])

      expect(current.activation).toEqual({ multi: true })
      expect(current.disabledTools).toEqual({ multi: ['a'] })
    })

    it('folds multiple plugins in one pass, each independently', () => {
      const current = {
        activation: { a: true, b: true },
        disabledTools: { a: ['x', 'stale'], b: ['y'] }
      }
      const result = reconcilePluginToolDisablement(current, [
        { id: 'a', toolIds: ['x'] }, // 'stale' GC'd, 'x' still partial-ish but covers all → heals
        { id: 'b', toolIds: ['y', 'z'] } // 'y' still a partial selection, unaffected
      ])

      expect(result.changed).toBe(true)
      // 'a': stored ['x','stale'] normalizes to ['x'], which covers plugin a's
      // only current tool — heals to activation off, entry cleared.
      expect(result.disabledTools).toEqual({ b: ['y'] })
      expect(result.activation).toEqual({ a: false, b: true })
    })
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
      get: (key) => Promise.resolve(key === SETTINGS_KEYS.webSpeechEnabled ? 'true' : undefined),
      set: () => Promise.resolve()
    })

    expect(state.webSpeechEnabled).toBe(true)
  })

  it('reads the stored selected model', async () => {
    const state = await loadSettingsState({
      get: (key) =>
        Promise.resolve(key === SETTINGS_KEYS.selectedModel ? 'openai/gpt-4o' : undefined),
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
        Promise.resolve(key === SETTINGS_KEYS.showReasoningActivity ? 'true' : undefined),
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
        Promise.resolve(key === SETTINGS_KEYS.showCodeBlockFullscreenButton ? 'false' : undefined),
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

    expect(writes).toEqual([{ key: 'settings_show_code_block_fullscreen_button', value: 'false' }])
  })

  it('drops malformed persisted MCP discovery entries during settings hydration', async () => {
    const validDiscovery: McpDiscoveryResult = {
      serverId: 'server-1',
      serverName: 'Weather Server',
      tools: [{ toolName: 'get_weather', description: 'Get weather', inputSchema: {} }],
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
      expect(canSendPrompt({ ...defaultChatState(), conversationId: undefined })).toBe(false)
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
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id' })).toBe(true)
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
    const deploymentA = 'https://litellm.nntin.xyz/'
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

    await applyRateLimitEvent(event('rate.limit.recovered', { retryAt: future }), prefs)

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

describe('compareEventOrder', () => {
  const orderedEvent = (id: string, timestamp: string, seq?: number): ChatEvent => ({
    id,
    timestamp,
    ...(seq === undefined ? {} : { seq }),
    type: 'user.message',
    payload: { text: '' }
  })

  it('orders by timestamp before seq', () => {
    const earlier = orderedEvent('a', '2026-07-05T00:00:00.001Z', 9)
    const later = orderedEvent('b', '2026-07-05T00:00:00.002Z', 0)

    expect(compareEventOrder(earlier, later)).toBeLessThan(0)
    expect(compareEventOrder(later, earlier)).toBeGreaterThan(0)
  })

  it('breaks same-millisecond ties by seq', () => {
    const first = orderedEvent('z', '2026-07-05T00:00:00.001Z', 3)
    const second = orderedEvent('a', '2026-07-05T00:00:00.001Z', 4)

    expect(compareEventOrder(first, second)).toBeLessThan(0)
    expect(compareEventOrder(second, first)).toBeGreaterThan(0)
  })

  it('sorts legacy events (no seq) before seq-bearing ones at the same timestamp', () => {
    const legacy = orderedEvent('z', '2026-07-05T00:00:00.001Z')
    const stamped = orderedEvent('a', '2026-07-05T00:00:00.001Z', 0)

    expect(compareEventOrder(legacy, stamped)).toBeLessThan(0)
    expect(compareEventOrder(stamped, legacy)).toBeGreaterThan(0)
  })

  it('falls back to id when timestamp and seq are equal', () => {
    const a = orderedEvent('a', '2026-07-05T00:00:00.001Z')
    const b = orderedEvent('b', '2026-07-05T00:00:00.001Z')

    expect(compareEventOrder(a, b)).toBeLessThan(0)
    expect(compareEventOrder(b, a)).toBeGreaterThan(0)
    expect(compareEventOrder(a, { ...a })).toBe(0)
  })

  it('restores tool started/completed order for same-millisecond replay (#333)', () => {
    const timestamp = '2026-07-05T00:00:00.000Z'
    const events: ChatEvent[] = [
      {
        id: 'evt-completed',
        timestamp,
        seq: 2,
        type: 'agent.tool.completed',
        payload: { stepId: 'act-1', toolId: 'web-search', output: { results: [] } }
      },
      {
        id: 'evt-started',
        timestamp,
        seq: 1,
        type: 'agent.tool.started',
        payload: { stepId: 'act-1', toolId: 'web-search', input: { query: 'hi' } }
      },
      {
        id: 'evt-user',
        timestamp,
        seq: 0,
        type: 'user.message',
        payload: { text: 'hi' }
      }
    ]

    const turns = buildTurns([...events].sort(compareEventOrder))
    expect(turns).toHaveLength(1)
    const tools = turns[0]?.activity.items.filter((item) => item.kind === 'tool') ?? []
    // Without deterministic ordering the completed event replays before its
    // started sibling and leaves an extra tool item stuck in 'started'.
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ toolId: 'web-search', status: 'completed' })
  })
})
