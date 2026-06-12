import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { edgeErrorResponseSchema, mcpCallResponseSchema, mcpDiscoveryResultSchema } from '@tinytinkerer/contracts'
import app from '../index.js'
import { clearCallerValidationCache } from '../lib/caller-validation-cache.js'
import { clearInboundRateLimits } from '../lib/inbound-rate-limit.js'

const AUTH = { authorization: 'Bearer test-token' }
const CT = { 'content-type': 'application/json' }
const HEADERS = { ...CT, ...AUTH }

// Both MCP routes validate the caller's GitHub identity (an api.github.com/user
// probe) before connecting, so the SDK mocks alone are not enough — global
// `fetch` must answer that probe. The SDK transport is mocked, so the GitHub
// probe is the only real fetch these tests make.
const GITHUB_USER_URL = 'https://api.github.com/user'
const toRequestUrl = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
const githubUserOk = () =>
  new Response(JSON.stringify({ login: 'nntin' }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
/** Stub `fetch` so the caller-validation probe answers with `status`; nothing else is fetched. */
const stubCallerValidation = (status = 200) =>
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      if (toRequestUrl(input) === GITHUB_USER_URL) {
        return Promise.resolve(
          status === 200 ? githubUserOk() : new Response('', { status })
        )
      }
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
  )

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = HEADERS,
  env: Record<string, string> = {}
) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    env
  )

// --- MCP SDK mock ---
const mockConnect = vi.fn()
const mockListTools = vi.fn()
const mockCallTool = vi.fn()
const mockGetServerVersion = vi.fn()
const mockClose = vi.fn()

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return {
      connect: mockConnect,
      listTools: mockListTools,
      callTool: mockCallTool,
      getServerVersion: mockGetServerVersion,
      close: mockClose
    }
  })
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(function () { return {} })
}))

beforeEach(() => {
  // Default: a valid caller. Individual tests override for invalid/unavailable.
  stubCallerValidation(200)
  mockConnect.mockResolvedValue(undefined)
  mockGetServerVersion.mockReturnValue({ name: 'TestServer', version: '1.0' })
  mockListTools.mockResolvedValue({
    tools: [
      {
        name: 'get_weather',
        description: 'Get current weather',
        inputSchema: { location: { type: 'string' } }
      }
    ]
  })
  mockCallTool.mockResolvedValue({
    content: [{ type: 'text', text: 'Sunny, 22°C' }],
    isError: false
  })
  mockClose.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  // A caller validated in one test must not skip the GitHub probe in the next.
  clearCallerValidationCache()
  // The inbound rate-limit windows are module-level too; one test's requests
  // must not eat into the next test's budget.
  clearInboundRateLimits()
})

describe('POST /api/mcp/discover', () => {
  it('returns 401 without authorization', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com' }, CT)
    expect(res.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await res.json())).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when the caller fails GitHub validation, without connecting', async () => {
    stubCallerValidation(401)
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    expect(res.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await res.json())).toEqual({ error: 'Unauthorized' })
    // The outbound MCP connection must never be attempted for an invalid caller.
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('returns 503 when caller validation is unavailable (GitHub outage), without connecting', async () => {
    stubCallerValidation(503)
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    expect(res.status).toBe(503)
    const body = edgeErrorResponseSchema.parse(await res.json())
    expect(body.error).toMatch(/validation is temporarily unavailable/i)
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-http(s) scheme', async () => {
    const res = await post('/api/mcp/discover', { url: 'ftp://mcp.example.com' })
    expect(res.status).toBe(400)
    const body = edgeErrorResponseSchema.parse(await res.json())
    expect(body.error).toMatch(/invalid|disallowed/i)
  })

  it('returns 400 for http to a non-localhost host', async () => {
    const res = await post('/api/mcp/discover', { url: 'http://mcp.example.com/mcp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for https to a private 10.x.x.x IP', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://10.0.0.1/mcp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for https to a 192.168.x.x IP', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://192.168.1.100/mcp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for https to a 172.16-31.x.x IP', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://172.20.0.5/mcp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for https to the IPv4 loopback', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://127.0.0.1/mcp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for https to the link-local range', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://169.254.1.2/mcp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for https to a GCP metadata endpoint', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://metadata.google.internal/mcp' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for https to the Azure IMDS hostname', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://metadata.azure.internal/mcp' })
    expect(res.status).toBe(400)
  })

  // DNS rebinding / SSRF via resolution is a known gap: this validation only
  // checks literal IPs and a handful of well-known hostnames. A public-looking
  // hostname (e.g. attacker.example.com) that DNS-resolves to a private address
  // will still pass, because pre-flight DNS resolution is not available in this
  // runtime environment.
  it('passes a public-looking hostname even though DNS could resolve it privately (known gap)', async () => {
    // This test documents the limitation, not a desired behaviour.
    // mcp.example.com is a structurally valid public hostname; we cannot know
    // its resolved IP at validation time, so it passes through to the SDK.
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    // 200 (SDK mock succeeds) or 502 (SDK fails) both confirm we reached the handler
    expect([200, 502]).toContain(res.status)
    expect(res.status).not.toBe(400)
  })

  it('allows public hostnames that only start with IPv6-private prefixes', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://fcn.example.com/mcp' })
    expect([200, 502]).toContain(res.status)
    expect(res.status).not.toBe(400)
  })

  // MCP_ALLOWED_HOSTS closes the DNS-rebinding gap documented above: when the
  // binding is set, ONLY the listed hosts pass — a public-looking hostname that
  // would slip past the blocklist is rejected unless explicitly trusted.
  describe('MCP_ALLOWED_HOSTS allowlist', () => {
    const ALLOWLIST_ENV = { MCP_ALLOWED_HOSTS: 'mcp.example.com' }

    it('allows a listed host', async () => {
      const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' }, HEADERS, ALLOWLIST_ENV)
      expect(res.status).toBe(200)
      mcpDiscoveryResultSchema.parse(await res.json())
    })

    it('rejects an unlisted host that the blocklist alone would pass', async () => {
      const res = await post('/api/mcp/discover', { url: 'https://attacker.example.com/mcp' }, HEADERS, ALLOWLIST_ENV)
      expect(res.status).toBe(400)
      const body = edgeErrorResponseSchema.parse(await res.json())
      expect(body.error).toMatch(/invalid|disallowed/i)
      expect(mockConnect).not.toHaveBeenCalled()
    })

    it('rejects unlisted localhost too — a configured allowlist is authoritative', async () => {
      const res = await post('/api/mcp/discover', { url: 'http://localhost/mcp' }, HEADERS, ALLOWLIST_ENV)
      expect(res.status).toBe(400)
    })

    it('matches hosts case-insensitively and ignores whitespace around entries', async () => {
      const env = { MCP_ALLOWED_HOSTS: ' MCP.Example.com , other.example.org ' }
      const allowed = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' }, HEADERS, env)
      expect(allowed.status).toBe(200)
      const rejected = await post('/api/mcp/discover', { url: 'https://elsewhere.example.com/mcp' }, HEADERS, env)
      expect(rejected.status).toBe(400)
    })

    it('preserves blocklist behaviour when the binding is empty', async () => {
      const env = { MCP_ALLOWED_HOSTS: '' }
      const publicHost = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' }, HEADERS, env)
      expect(publicHost.status).toBe(200)
      const privateIp = await post('/api/mcp/discover', { url: 'https://10.0.0.1/mcp' }, HEADERS, env)
      expect(privateIp.status).toBe(400)
    })

    it('applies the allowlist to the call route as well', async () => {
      const rejected = await post(
        '/api/mcp/call',
        { url: 'https://attacker.example.com/mcp', toolName: 'get_weather', arguments: {} },
        HEADERS,
        ALLOWLIST_ENV
      )
      expect(rejected.status).toBe(400)
      expect(mockConnect).not.toHaveBeenCalled()

      const allowed = await post(
        '/api/mcp/call',
        { url: 'https://mcp.example.com/mcp', toolName: 'get_weather', arguments: {} },
        HEADERS,
        ALLOWLIST_ENV
      )
      expect(allowed.status).toBe(200)
      mcpCallResponseSchema.parse(await allowed.json())
    })
  })

  it('allows http to localhost', async () => {
    const res = await post('/api/mcp/discover', { url: 'http://localhost/mcp' })
    expect(res.status).toBe(200)
    mcpDiscoveryResultSchema.parse(await res.json())
  })

  it('allows http to 127.0.0.1', async () => {
    const res = await post('/api/mcp/discover', { url: 'http://127.0.0.1:3111/mcp' })
    expect(res.status).toBe(200)
  })

  it('returns normalized discovery result for a valid https URL', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    expect(res.status).toBe(200)
    const body = mcpDiscoveryResultSchema.parse(await res.json())
    expect(body.serverName).toBe('TestServer')
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0]).toMatchObject({
      toolName: 'get_weather',
      description: 'Get current weather'
    })
    expect(body.syncedAt).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('returns 502 with a generic message (no raw SDK detail) when connect throws', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Connection refused to 10.0.0.5:443'))
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    expect(res.status).toBe(502)
    const body = edgeErrorResponseSchema.parse(await res.json())
    // LOW-1: the raw transport error must not be reflected to the client.
    expect(body.error).toBe('MCP discovery failed')
    expect(body.error).not.toContain('10.0.0.5')
  })

  it('returns 502 when listTools throws', async () => {
    mockListTools.mockRejectedValueOnce(new Error('ListTools failed'))
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    expect(res.status).toBe(502)
  })

  it('closes the client even when discovery fails', async () => {
    mockConnect.mockRejectedValueOnce(new Error('oops'))
    await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('passes the bearer token in the transport headers when provided', async () => {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp', bearerToken: 'server-secret' })
    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        requestInit: { headers: { authorization: 'Bearer server-secret' } }
      })
    )
  })
})

describe('POST /api/mcp/call', () => {
  it('returns 401 without authorization', async () => {
    const res = await post(
      '/api/mcp/call',
      { url: 'https://mcp.example.com/mcp', toolName: 'get_weather', arguments: {} },
      CT
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when the caller fails GitHub validation, without connecting', async () => {
    stubCallerValidation(401)
    const res = await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'get_weather',
      arguments: {}
    })
    expect(res.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await res.json())).toEqual({ error: 'Unauthorized' })
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('returns 503 when caller validation is unavailable, without connecting', async () => {
    stubCallerValidation(503)
    const res = await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'get_weather',
      arguments: {}
    })
    expect(res.status).toBe(503)
    const body = edgeErrorResponseSchema.parse(await res.json())
    expect(body.error).toMatch(/validation is temporarily unavailable/i)
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('returns 400 for a private IP URL', async () => {
    const res = await post('/api/mcp/call', {
      url: 'https://10.0.0.1/mcp',
      toolName: 'get_weather',
      arguments: {}
    })
    expect(res.status).toBe(400)
  })

  it('returns normalized call result for a valid URL', async () => {
    const res = await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'get_weather',
      arguments: { location: 'Berlin' }
    })
    expect(res.status).toBe(200)
    const body = mcpCallResponseSchema.parse(await res.json())
    expect(body.serverName).toBe('TestServer')
    expect(body.toolName).toBe('get_weather')
    expect(body.text).toBe('Sunny, 22°C')
    expect(body.isError).toBe(false)
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'get_weather', arguments: { location: 'Berlin' } })
  })

  it('surfaces isError:true when the MCP server returns an error result', async () => {
    mockCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Unknown location' }],
      isError: true
    })
    const res = await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'get_weather',
      arguments: {}
    })
    expect(res.status).toBe(200)
    const body = mcpCallResponseSchema.parse(await res.json())
    expect(body.isError).toBe(true)
    expect(body.text).toBe('Unknown location')
  })

  it('returns 502 with a generic message (no raw SDK detail) when callTool throws', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('ToolNotFound at internal-host:9000'))
    const res = await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'missing_tool',
      arguments: {}
    })
    expect(res.status).toBe(502)
    const body = edgeErrorResponseSchema.parse(await res.json())
    // LOW-1: the raw transport error must not be reflected to the client.
    expect(body.error).toBe('MCP call failed')
    expect(body.error).not.toContain('internal-host')
  })

  it('closes the client even when the call fails', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('oops'))
    await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'get_weather',
      arguments: {}
    })
    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('concatenates multiple text content items into a single text field', async () => {
    mockCallTool.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Part 1.' },
        { type: 'image', data: 'base64...' },
        { type: 'text', text: ' Part 2.' }
      ],
      isError: false
    })
    const res = await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'get_weather',
      arguments: {}
    })
    expect(res.status).toBe(200)
    const body = mcpCallResponseSchema.parse(await res.json())
    expect(body.text).toBe('Part 1.\n Part 2.')
  })
})
