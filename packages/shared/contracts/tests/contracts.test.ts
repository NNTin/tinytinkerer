import { describe, expect, it } from 'vitest'
import {
  brandDefinitionSchema,
  chatEventSchema,
  contentDocumentSchema,
  edgeErrorResponseSchema,
  githubExchangeRequestSchema,
  modelProviderIdSchema,
  modelsChatRequestSchema,
  modelsListResponseSchema,
  rateLimitPayloadSchema,
  searchResponseSchema,
  systemStatusSchema,
  validateLiteLLMBaseUrlPolicy
} from '../src/index.js'

describe('contracts', () => {
  it('parses chat events', () => {
    const event = chatEventSchema.parse({
      id: '1',
      timestamp: new Date().toISOString(),
      type: 'assistant.done',
      payload: {
        source: 'ok',
        content: {
          nodes: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'ok' }]
            }
          ]
        }
      }
    })

    expect(event.type).toBe('assistant.done')
  })

  it('keeps the canonical content schema and assistant alias aligned', () => {
    const document = {
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'ok' }]
        }
      ]
    }

    expect(contentDocumentSchema.parse(document)).toEqual(document)
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

    expect(edgeErrorResponseSchema.parse({ error: 'Unauthorized' }).error).toBe(
      'Unauthorized'
    )
  })

  it('parses model and rate-limit payloads', () => {
    expect(
      modelsChatRequestSchema.parse({
        provider: 'litellm',
        litellmBaseUrl: 'https://litellm.labs.lair.nntin.xyz/',
        model: 'openai/gpt-4.1-mini',
        stream: true,
        messages: [
          { role: 'developer', content: 'answer tersely' },
          { role: 'user', content: 'hi' }
        ]
      }).messages
    ).toHaveLength(2)

    expect(
      rateLimitPayloadSchema.parse({
        code: 'rate_limited',
        error: 'too many requests',
        retryAfterMs: 1_000,
        retryAt: new Date().toISOString()
      }).code
    ).toBe('rate_limited')
  })

  it('parses models list response', () => {
    expect(
      modelsListResponseSchema.parse({
        models: [
          {
            provider: 'litellm',
            context_length: 128000,
            id: 'openai/gpt-4.1-mini',
            label: 'GPT-4.1 mini',
            kind: 'chat',
            publisher: 'OpenAI',
            limits: { max_input_tokens: 1048576 }
          },
          {
            id: 'openai/text-embedding-3-small',
            label: 'text-embedding-3-small',
            kind: 'embedding'
          }
        ]
      }).models
    ).toHaveLength(2)

    expect(modelsListResponseSchema.parse({ models: [] }).models).toHaveLength(
      0
    )
  })

  it('rejects the removed github/openrouter provider ids', () => {
    expect(modelProviderIdSchema.parse('litellm')).toBe('litellm')
    expect(modelProviderIdSchema.safeParse('github').success).toBe(false)
    expect(modelProviderIdSchema.safeParse('openrouter').success).toBe(false)
  })

  it('validates the shared LiteLLM base URL policy', () => {
    const accepted = validateLiteLLMBaseUrlPolicy(
      'https://litellm.example.com'
    )
    expect(accepted).toMatchObject({
      ok: true,
      canonicalUrl: 'https://litellm.example.com/'
    })

    expect(
      validateLiteLLMBaseUrlPolicy('http://litellm.example.com')
    ).toEqual({ ok: false, reason: 'non-https' })

    for (const value of [
      'https://user:pw@litellm.example.com',
      'https://litellm.example.com/?key=1',
      'https://litellm.example.com/#frag'
    ]) {
      expect(validateLiteLLMBaseUrlPolicy(value)).toEqual({
        ok: false,
        reason: 'forbidden-url-parts'
      })
    }
  })

  it('checks LiteLLM base URLs against a caller-canonicalized allowlist', () => {
    const canonicalize = (url: URL): string => url.href.replace(/\/+$/, '')
    const allowedBaseUrls = new Set(['https://litellm.example.com'])

    expect(
      validateLiteLLMBaseUrlPolicy('https://litellm.example.com/', {
        allowedBaseUrls,
        canonicalize
      })
    ).toMatchObject({
      ok: true,
      canonicalUrl: 'https://litellm.example.com'
    })

    expect(
      validateLiteLLMBaseUrlPolicy('https://evil.example.com/', {
        allowedBaseUrls,
        canonicalize
      })
    ).toEqual({ ok: false, reason: 'not-allowed' })
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
          icons: [
            {
              src: 'data:image/svg+xml,test',
              sizes: '512x512',
              type: 'image/svg+xml'
            }
          ]
        }
      }).manifest.display
    ).toBe('standalone')
  })
})
