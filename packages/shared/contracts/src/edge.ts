// Hand-authored edge API contracts: the single source of truth for the edge
// Worker's request/response schemas, inferred types, and route/header constants.
//
// The edge app (apps/edge) builds its routes from these schemas with
// @hono/zod-openapi and emits the published OpenAPI document at
// apps/edge/openapi/tinytinkerer-edge.openapi.json via
// scripts/generate-edge-openapi.ts. Frontends import these same schemas/types
// and validate at runtime — so the contract, the spec, and the wire stay in sync.
//
// `.meta({ id })` names a schema as a reusable OpenAPI component ($ref) in the
// generated document; it has no effect on runtime parsing.
import { z } from 'zod'

export const serviceStatusSchema = z
  .object({
    state: z.enum(['ready', 'degraded', 'offline']),
    detail: z.string(),
    error: z.string().optional()
  })
  .meta({ id: 'ServiceStatus' })

export type ServiceStatus = z.infer<typeof serviceStatusSchema>

export const systemStatusSchema = z
  .object({
    auth: serviceStatusSchema,
    models: serviceStatusSchema,
    search: serviceStatusSchema
  })
  .meta({ id: 'SystemStatus' })

export type SystemStatus = z.infer<typeof systemStatusSchema>

export const searchResultSchema = z
  .object({
    title: z.string(),
    url: z.string(),
    snippet: z.string()
  })
  .meta({ id: 'SearchResult' })

export type SearchResult = z.infer<typeof searchResultSchema>

export const searchRequestSchema = z
  .object({
    query: z.string().min(2).max(500),
    maxResults: z.number().int().positive().max(10).optional()
  })
  .meta({ id: 'SearchRequest' })

export type SearchRequest = z.infer<typeof searchRequestSchema>

export const searchResponseSchema = z
  .object({
    query: z.string(),
    results: z.array(searchResultSchema)
  })
  .meta({ id: 'SearchResponse' })

export type SearchResponse = z.infer<typeof searchResponseSchema>

export const chatMessageSchema = z
  .object({
    role: z.enum(['developer', 'system', 'user', 'assistant']),
    content: z.string().max(32000)
  })
  .meta({ id: 'ChatMessage' })

export type ChatMessage = z.infer<typeof chatMessageSchema>

// LiteLLM is the sole provider — it proxies the upstream LLM providers itself.
// The enum (and the optional `provider` request field) is kept so the wire
// shape stays extensible; legacy 'github'/'openrouter' values now fail
// validation.
export const modelProviderIdSchema = z
  .enum(['litellm'])
  .meta({ id: 'ModelProviderId' })

export type ModelProviderId = z.infer<typeof modelProviderIdSchema>

export const modelsChatRequestSchema = z
  .object({
    provider: modelProviderIdSchema.optional(),
    model: z.string().optional(),
    litellmBaseUrl: z.string().url().optional(),
    stream: z.boolean().optional(),
    messages: z.array(chatMessageSchema).max(100)
  })
  .meta({ id: 'ModelsChatRequest' })

export type ModelsChatRequest = z.infer<typeof modelsChatRequestSchema>

export const modelsChatChoiceSchema = z
  .object({
    message: z
      .object({
        role: z.string().optional(),
        content: z.string().nullable().optional()
      })
      .optional(),
    finish_reason: z.string().optional()
  })
  .meta({ id: 'ModelsChatChoice' })

export type ModelsChatChoice = z.infer<typeof modelsChatChoiceSchema>

export const modelsChatResponseSchema = z
  .object({
    choices: z.array(modelsChatChoiceSchema).optional(),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens: z.number().optional()
      })
      .optional()
  })
  .meta({ id: 'ModelsChatResponse' })

export type ModelsChatResponse = z.infer<typeof modelsChatResponseSchema>

export const modelKindSchema = z
  .enum(['chat', 'embedding'])
  .meta({ id: 'ModelKind' })

export type ModelKind = z.infer<typeof modelKindSchema>

export const modelLimitsSchema = z
  .object({
    max_input_tokens: z.number().nullable().optional(),
    max_output_tokens: z.number().nullable().optional()
  })
  .meta({ id: 'ModelLimits' })

export type ModelLimits = z.infer<typeof modelLimitsSchema>

export const modelEntrySchema = z
  .object({
    provider: modelProviderIdSchema.optional(),
    id: z.string(),
    label: z.string(),
    kind: modelKindSchema.optional(),
    name: z.string().optional(),
    publisher: z.string().optional(),
    registry: z.string().optional(),
    summary: z.string().optional(),
    html_url: z.string().url().optional(),
    version: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    limits: modelLimitsSchema.optional(),
    context_length: z.number().nullable().optional(),
    pricing: z.record(z.string(), z.unknown()).optional(),
    architecture: z.record(z.string(), z.unknown()).optional(),
    rate_limit_tier: z.string().optional(),
    supported_input_modalities: z.array(z.string()).optional(),
    supported_output_modalities: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  })
  .meta({ id: 'ModelEntry' })

export type ModelEntry = z.infer<typeof modelEntrySchema>

export const modelsListResponseSchema = z
  .object({
    models: z.array(modelEntrySchema)
  })
  .meta({ id: 'ModelsListResponse' })

export type ModelsListResponse = z.infer<typeof modelsListResponseSchema>

export const edgeErrorResponseSchema = z
  .object({ error: z.string() })
  .meta({ id: 'EdgeErrorResponse' })

export type EdgeErrorResponse = z.infer<typeof edgeErrorResponseSchema>

export const rateLimitPayloadSchema = z
  .object({
    code: z.literal('rate_limited'),
    error: z.string(),
    retryAfterMs: z.number().min(0),
    retryAt: z.string()
  })
  .meta({ id: 'RateLimitPayload' })

export type RateLimitPayload = z.infer<typeof rateLimitPayloadSchema>

export const githubExchangeRequestSchema = z
  .object({
    code: z.string().min(1),
    redirectUri: z.string().url().optional()
  })
  .meta({ id: 'GitHubExchangeRequest' })

export type GitHubExchangeRequest = z.infer<typeof githubExchangeRequestSchema>

export const githubExchangeResponseSchema = z
  .object({
    accessToken: z.string().optional(),
    error: z.string().optional()
  })
  .meta({ id: 'GitHubExchangeResponse' })

export type GitHubExchangeResponse = z.infer<
  typeof githubExchangeResponseSchema
>

export const mcpServerConfigSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    url: z.string().url(),
    bearerToken: z.string().optional(),
    enabled: z.boolean()
  })
  .meta({ id: 'McpServerConfig' })

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>

export const mcpToolMetaSchema = z
  .object({
    toolName: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown())
  })
  .meta({ id: 'McpToolMeta' })

export type McpToolMeta = z.infer<typeof mcpToolMetaSchema>

export const mcpDiscoveryResultSchema = z
  .object({
    serverId: z.string(),
    serverName: z.string(),
    tools: z.array(mcpToolMetaSchema),
    syncedAt: z.string(),
    error: z.string().optional()
  })
  .meta({ id: 'McpDiscoveryResult' })

export type McpDiscoveryResult = z.infer<typeof mcpDiscoveryResultSchema>

export const mcpDiscoverRequestSchema = z
  .object({
    url: z.string(),
    bearerToken: z.string().optional()
  })
  .meta({ id: 'McpDiscoverRequest' })

export type McpDiscoverRequest = z.infer<typeof mcpDiscoverRequestSchema>

export const mcpCallRequestSchema = z
  .object({
    url: z.string(),
    bearerToken: z.string().optional(),
    toolName: z.string(),
    arguments: z.record(z.string(), z.unknown())
  })
  .meta({ id: 'McpCallRequest' })

export type McpCallRequest = z.infer<typeof mcpCallRequestSchema>

export const mcpCallResponseSchema = z
  .object({
    serverName: z.string(),
    toolName: z.string(),
    text: z.string(),
    raw: z.unknown(),
    isError: z.boolean()
  })
  .meta({ id: 'McpCallResponse' })

export type McpCallResponse = z.infer<typeof mcpCallResponseSchema>

export const TELEMETRY_HEADERS = {
  appVersion: 'X-App-Version',
  buildHash: 'X-Build-Hash',
  installId: 'X-Install-ID',
  githubId: 'X-GitHub-ID'
} as const

export const telemetryHeadersSchema = z.object({
  appVersion: z.string().max(128).optional(),
  buildHash: z.string().max(128).optional(),
  installId: z.string().max(128).optional(),
  githubId: z.string().max(128).optional()
})

export type TelemetryHeaders = z.infer<typeof telemetryHeadersSchema>

// Shared LiteLLM default model. There is deliberately NO default base URL
// constant: the deployment default lives only in the edge's wrangler config
// (a missing LITELLM_BASE_URL is a 503 "not configured"), and clients signal
// "use the deployment default" by omitting `litellmBaseUrl` from requests. A
// code-level URL here would silently point forks at someone else's LiteLLM —
// or trip their edge allowlist with a 400 "not allowed" on every request.
export const DEFAULT_LITELLM_MODEL = 'openai/gpt-5'

export const EDGE_ROUTE_PATHS = {
  health: '/health',
  authGithubExchange: '/auth/github/exchange',
  search: '/api/search',
  modelsList: '/api/models/list',
  modelsChat: '/api/models/chat',
  mcpDiscover: '/api/mcp/discover',
  mcpCall: '/api/mcp/call'
} as const

export type EdgeRoutePath =
  (typeof EDGE_ROUTE_PATHS)[keyof typeof EDGE_ROUTE_PATHS]

export const EDGE_HEADER_NAMES = {
  appVersion: 'X-App-Version',
  buildHash: 'X-Build-Hash',
  installId: 'X-Install-ID',
  githubId: 'X-GitHub-ID',
  authorization: 'Authorization',
  contentType: 'Content-Type',
  retryAfter: 'Retry-After',
  cacheControl: 'Cache-Control',
  accelBuffering: 'X-Accel-Buffering'
} as const

export const EDGE_RATE_LIMIT_HEADERS = [
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-renewalperiod-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
  'x-ratelimit-renewalperiod-tokens',
  'x-ratelimit-abusepenalty-active'
] as const

export const EDGE_EXPOSED_HEADERS = [
  ...EDGE_RATE_LIMIT_HEADERS,
  'retry-after'
] as const
