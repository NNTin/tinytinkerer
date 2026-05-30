import { describe, expect, it } from 'vitest'
import type { ContentDocument, ChatEvent, McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import {
  activeCooldown,
  buildConversationHistory,
  buildTurns,
  canSendPrompt,
  defaultChatState,
  defaultSettingsState,
  inferPlan,
  loadSettingsState,
  normalizeSelectedModel,
  persistBooleanPreference,
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
    expect(inferPlan('latest ai news').steps.some((step) => step.id === 'search')).toBe(true)
  })

  it('falls back to the default model for null/empty values', () => {
    expect(normalizeSelectedModel(null)).toBe('openai/gpt-4.1-mini')
    expect(normalizeSelectedModel(undefined)).toBe('openai/gpt-4.1-mini')
    expect(normalizeSelectedModel('')).toBe('openai/gpt-4.1-mini')
    expect(normalizeSelectedModel('   ')).toBe('openai/gpt-4.1-mini')
  })

  it('preserves any non-empty model id including dynamic models', () => {
    expect(normalizeSelectedModel('openai/gpt-4o')).toBe('openai/gpt-4o')
    expect(normalizeSelectedModel('meta/llama-4-scout-17b-16e-instruct')).toBe('meta/llama-4-scout-17b-16e-instruct')
  })

  it('builds conversation history from completed turns only', () => {
    expect(
      buildConversationHistory([
        event('user.message', { text: 'hello' }),
        event('assistant.done', { source: 'hi', content: assistantContent('hi') }),
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
      event('agent.step.started', { stepId: 'plan', kind: 'plan', title: 'Created 1-step plan' }),
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
      event('agent.tool.started', { stepId: 'act-1', toolId: 'web-search', input: { query: 'hello' } }),
      event('agent.tool.completed', { stepId: 'act-1', toolId: 'web-search', output: { query: 'hello', results: [] } }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    const activity = buildTurns(events)[0]?.activity
    expect(activity?.reasoningText).toBe('thinking… done')
    const tools = activity?.items.filter((item) => item.kind === 'tool') ?? []
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({ toolId: 'web-search', status: 'completed' })
    expect(activity?.items.filter((item) => item.kind === 'reasoning')).toHaveLength(1)
  })

  it('keeps one turn when rate-limit waiting later completes', () => {
    const turns = buildTurns(
      [
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
      ]
    )

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
    const turns = buildTurns(
      [
        event('user.message', { text: 'hello' }),
        event('system', { message: 'Using cached context.', level: 'info' }),
        event('assistant.done', { source: 'Hi there.', content: assistantContent('Hi there.') })
      ]
    )

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
        payload: { source: 'hi there', content: 'hi there' as unknown as ContentDocument }
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
      event('agent.step.started', { stepId: 'plan', kind: 'plan', title: 'Created 0-step plan' }),
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
    const labels = buildTurns(events)[0]?.activity.items.filter((item) => item.kind === 'label') ?? []
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

  it('hydrates reasoning & activity from the stored preference key', async () => {
    const state = await loadSettingsState({
      get: (key) => Promise.resolve(key === SETTINGS_KEYS.showReasoningActivity ? 'true' : undefined),
      set: () => Promise.resolve()
    })

    expect(state.showReasoningActivity).toBe(true)
  })

  it('migrates reasoning & activity from either legacy toggle when the new key is unset', async () => {
    const state = await loadSettingsState({
      get: (key) => Promise.resolve(key === 'settings_show_tool_activity' ? 'true' : undefined),
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
          key === SETTINGS_KEYS.showCodeBlockFullscreenButton ? 'false' : undefined
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
      tools: [{ toolName: 'get_weather', description: 'Get weather', inputSchema: {} }],
      syncedAt: new Date().toISOString()
    }
    const state = await loadSettingsState({
      get: (key) =>
        key === 'settings_mcp_discovery'
          ? Promise.resolve(JSON.stringify({
            'server-1': validDiscovery,
            broken: { serverId: 'broken', serverName: 42, tools: [], syncedAt: 'now' }
          }))
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
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id', isRunning: true })).toBe(false)
    })

    it('returns false when cooldown is active', () => {
      const future = new Date(Date.now() + 60_000).toISOString()
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id', cooldownUntil: future })).toBe(false)
    })

    it('returns true when cooldown has expired', () => {
      const past = new Date(Date.now() - 1_000).toISOString()
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id', cooldownUntil: past })).toBe(true)
    })

    it('returns true when all conditions are clear', () => {
      expect(canSendPrompt({ ...defaultChatState(), conversationId: 'id' })).toBe(true)
    })
  })
})
