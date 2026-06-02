import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  EDGE_RATE_LIMIT_HEADERS,
  EDGE_ROUTE_PATHS,
  TELEMETRY_HEADERS,
  modelsChatRequestSchema,
  searchRequestSchema,
  telemetryHeadersSchema
} from '../src/index.js'

// The single, generated edge OpenAPI document. It is produced from the edge code
// (apps/edge route definitions + these shared schemas) by
// scripts/generate-edge-openapi.ts and verified fresh in CI via
// `pnpm check:edge-openapi`; these tests assert its shape and that the contracts
// it is generated from stay consistent with it.
const spec = JSON.parse(
  readFileSync(
    new URL(
      '../../../../apps/edge/openapi/tinytinkerer-edge.openapi.json',
      import.meta.url
    ),
    'utf8'
  )
) as {
  security: unknown
  paths: Record<
    string,
    Record<string, { security?: unknown; responses: Record<string, unknown> }>
  >
}

const ROUTE_METHOD: Record<string, string> = {
  '/health': 'get',
  '/auth/github/exchange': 'post',
  '/api/search': 'post',
  '/api/models/list': 'get',
  '/api/models/chat': 'post',
  '/api/mcp/discover': 'post',
  '/api/mcp/call': 'post'
}

describe('edge openapi spec', () => {
  it('documents every edge route with its method', () => {
    expect(Object.keys(spec.paths).sort()).toEqual(
      Object.keys(ROUTE_METHOD).sort()
    )

    for (const [path, method] of Object.entries(ROUTE_METHOD)) {
      expect(spec.paths[path]?.[method], `${path} ${method}`).toBeDefined()
    }
  })

  it('requires bearer auth globally and opts out only for /health', () => {
    expect(spec.security).toEqual([{ BearerToken: [] }])

    // /health overrides to no auth.
    expect(spec.paths['/health']?.get?.security).toEqual([])

    // Protected operations inherit the global bearer requirement (no override).
    expect(spec.paths['/api/models/chat']?.post?.security).toBeUndefined()
    expect(spec.paths['/api/search']?.post?.security).toBeUndefined()
  })

  it('declares the SSE stream and rate-limit headers on chat completions', () => {
    const ok = spec.paths['/api/models/chat']?.post?.responses?.['200'] as {
      content: Record<string, unknown>
      headers: Record<string, unknown>
    }
    expect(Object.keys(ok.content).sort()).toEqual([
      'application/json',
      'text/event-stream'
    ])
    for (const header of EDGE_RATE_LIMIT_HEADERS) {
      expect(ok.headers[header], header).toBeDefined()
    }
  })

  it('exposes Retry-After on rate-limited chat responses', () => {
    const rateLimited = spec.paths['/api/models/chat']?.post?.responses?.[
      '429'
    ] as { headers: Record<string, unknown> }
    expect(rateLimited).toBeDefined()
    expect(rateLimited.headers?.['Retry-After']).toBeDefined()
  })
})

describe('generated edge contracts', () => {
  it('exposes route-path constants matching the spec', () => {
    expect(new Set(Object.values(EDGE_ROUTE_PATHS))).toEqual(
      new Set(Object.keys(spec.paths))
    )
    expect(EDGE_ROUTE_PATHS.modelsChat).toBe('/api/models/chat')
  })

  it('keeps schema constraints from the contracts', () => {
    expect(searchRequestSchema.safeParse({ query: 'a' }).success).toBe(false)
    expect(searchRequestSchema.safeParse({ query: 'ab' }).success).toBe(true)
    expect(
      modelsChatRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'hi' }]
      }).success
    ).toBe(true)
  })

  it('derives telemetry header constants and validator together', () => {
    expect(TELEMETRY_HEADERS).toEqual({
      appVersion: 'X-App-Version',
      buildHash: 'X-Build-Hash',
      installId: 'X-Install-ID',
      githubId: 'X-GitHub-ID'
    })
    expect(
      telemetryHeadersSchema.safeParse({ appVersion: 'v1', buildHash: 'abc' })
        .success
    ).toBe(true)
    expect(
      telemetryHeadersSchema.safeParse({ appVersion: 'x'.repeat(129) }).success
    ).toBe(false)
    expect(EDGE_RATE_LIMIT_HEADERS).toHaveLength(9)
  })
})
