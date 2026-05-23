import { describe, expect, it } from 'vitest'
import {
  brandDefinitionSchema,
  chatEventSchema,
  githubExchangeRequestSchema,
  modelsChatRequestSchema,
  rateLimitPayloadSchema,
  searchResponseSchema,
  systemStatusSchema
} from '../src/index.js'

describe('contracts', () => {
  it('parses chat events', () => {
    const event = chatEventSchema.parse({
      id: '1',
      timestamp: new Date().toISOString(),
      type: 'assistant.done',
      payload: { text: 'ok' }
    })

    expect(event.type).toBe('assistant.done')
  })

  it('parses shared edge payloads', () => {
    expect(
      githubExchangeRequestSchema.parse({
        code: 'abc',
        redirectUri: 'https://example.com/callback'
      }).code
    ).toBe('abc')

    expect(
      searchResponseSchema.parse({
        query: 'hello',
        results: [{ title: 'x', url: 'https://example.com', snippet: 'y' }]
      }).results
    ).toHaveLength(1)

    expect(
      systemStatusSchema.parse({
        auth: { state: 'ready', detail: 'ok' },
        models: { state: 'degraded', detail: 'slow' },
        search: { state: 'offline', detail: 'down' }
      }).models.state
    ).toBe('degraded')
  })

  it('parses model and rate-limit payloads', () => {
    expect(
      modelsChatRequestSchema.parse({
        model: 'openai/gpt-4.1-mini',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }]
      }).messages
    ).toHaveLength(1)

    expect(
      rateLimitPayloadSchema.parse({
        code: 'rate_limited',
        error: 'too many requests',
        retryAfterMs: 1_000,
        retryAt: new Date().toISOString()
      }).code
    ).toBe('rate_limited')
  })

  it('parses shared brand metadata', () => {
    expect(
      brandDefinitionSchema.parse({
        theme: {
          applicationName: 'tinytinkerer',
          themeColor: '#f6f2ec',
          backgroundColor: '#fffaf5'
        },
        links: [{ rel: 'icon', href: 'data:image/svg+xml,test' }],
        manifest: {
          name: 'tinytinkerer',
          shortName: 'tinker',
          startUrl: '/',
          display: 'standalone',
          backgroundColor: '#fffaf5',
          themeColor: '#f6f2ec',
          icons: [{ src: 'data:image/svg+xml,test', sizes: '512x512', type: 'image/svg+xml' }]
        }
      }).manifest.display
    ).toBe('standalone')
  })
})
