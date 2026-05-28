import { describe, expect, it } from 'vitest'
import type { ContentDocument, ChatEvent, McpDiscoveryResult, McpServerConfig } from '@tinytinkerer/contracts'
import {
  activeCooldown,
  buildConversationHistory,
  buildCurrentTimeline,
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

  it('projects turns and timeline entries', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hello' }),
      event('planning.started', { summary: 'Understanding request' }),
      event('execution.step.started', {
        step: { id: 'search', summary: 'Search web', toolCall: { toolId: 'web-search', input: { query: 'hello' } } },
        index: 0
      }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]

    expect(buildTurns(events)).toHaveLength(1)
    expect(buildCurrentTimeline(events)).toHaveLength(2)
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

  it('buildCurrentTimeline returns empty array when no user.message is present', () => {
    expect(buildCurrentTimeline([])).toEqual([])
    expect(
      buildCurrentTimeline([
        event('planning.started', { summary: 'Understanding request' }),
        event('assistant.done', { source: 'hi', content: assistantContent('hi') })
      ])
    ).toEqual([])
  })

  it('execution.step.completed with empty note does not appear in timeline', () => {
    const events: ChatEvent[] = [
      event('user.message', { text: 'hello' }),
      event('execution.step.completed', { stepId: 'step-1', note: '' }),
      event('assistant.done', { source: 'hi', content: assistantContent('hi') })
    ]
    const timeline = buildCurrentTimeline(events)
    expect(timeline.every((entry) => entry.label !== '')).toBe(true)
    expect(timeline).toHaveLength(0)
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
