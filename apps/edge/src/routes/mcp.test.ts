import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { edgeErrorResponseSchema, mcpCallResponseSchema, mcpDiscoveryResultSchema } from '@tinytinkerer/contracts'
import app from '../index.js'

const AUTH = { authorization: 'Bearer test-token' }
const CT = { 'content-type': 'application/json' }
const HEADERS = { ...CT, ...AUTH }

const post = (path: string, body: unknown, headers = HEADERS) =>
  app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    {}
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
})

describe('POST /api/mcp/discover', () => {
  it('returns 401 without authorization', async () => {
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com' }, CT)
    expect(res.status).toBe(401)
    expect(edgeErrorResponseSchema.parse(await res.json())).toEqual({ error: 'Unauthorized' })
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

  it('allows http to localhost', async () => {
    const res = await post('/api/mcp/discover', { url: 'http://localhost/mcp' })
    expect(res.status).toBe(200)
    mcpDiscoveryResultSchema.parse(await res.json())
  })

  it('allows http to 127.0.0.1', async () => {
    const res = await post('/api/mcp/discover', { url: 'http://127.0.0.1:3000/mcp' })
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

  it('returns 502 when the MCP SDK connect throws', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Connection refused'))
    const res = await post('/api/mcp/discover', { url: 'https://mcp.example.com/mcp' })
    expect(res.status).toBe(502)
    const body = edgeErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('Connection refused')
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

  it('returns 502 when callTool throws', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('ToolNotFound'))
    const res = await post('/api/mcp/call', {
      url: 'https://mcp.example.com/mcp',
      toolName: 'missing_tool',
      arguments: {}
    })
    expect(res.status).toBe(502)
    const body = edgeErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('ToolNotFound')
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
