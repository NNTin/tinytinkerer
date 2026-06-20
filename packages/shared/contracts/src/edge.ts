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
    models: serviceStatusSchema
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

// Per-message content ceiling the edge enforces on every chat request. Exceeding
// it fails request validation, and the edge's OpenAPI defaultHook answers
// 400 "Invalid request" — which the ReAct decider rethrows, ending the whole run.
// Tool results are folded verbatim into the decide/synthesize prompt and can be
// large (a run_javascript result that returns the full `dom` tree, a big MCP
// response), so callers MUST clamp message content to this before sending (see
// clampChatMessageContent + modelsChatRequestBody). Root cause of
// TINYTINKERER-FRONTEND-14 / TINYTINKERER-FRONTEND-15.
export const MAX_CHAT_MESSAGE_CONTENT_CHARS = 32_000

export const chatMessageSchema = z
  .object({
    role: z.enum(['developer', 'system', 'user', 'assistant']),
    content: z.string().max(MAX_CHAT_MESSAGE_CONTENT_CHARS)
  })
  .meta({ id: 'ChatMessage' })

export type ChatMessage = z.infer<typeof chatMessageSchema>

// Clamp one message's content to MAX_CHAT_MESSAGE_CONTENT_CHARS when it would
// otherwise fail edge request validation with 400 "Invalid request" and abort the
// run (TINYTINKERER-FRONTEND-14/15). The cut keeps the head, so when tool results
// are appended last they are trimmed before the prompt. Rather than a bare marker,
// the appended notice is self-describing and ACTIONABLE — it states the original
// size and the limit and tells the model how to recover (ask for a smaller or
// aggregated result) — so the model can see the data is incomplete and adapt
// instead of silently reasoning over truncated content. The clamped length is
// exactly the ceiling.
export const clampChatMessageContent = (content: string): string => {
  if (content.length <= MAX_CHAT_MESSAGE_CONTENT_CHARS) {
    return content
  }
  const notice =
    `\n\n…[truncated to the model's ${MAX_CHAT_MESSAGE_CONTENT_CHARS}-char per-message ` +
    `limit, from ${content.length} chars; the tail was dropped — if you need the ` +
    `dropped part, re-run the tool asking for a smaller or aggregated result ` +
    `(e.g. counts, a filtered subset, or specific fields)]`
  const kept = Math.max(0, MAX_CHAT_MESSAGE_CONTENT_CHARS - notice.length)
  return `${content.slice(0, kept)}${notice}`
}

// LiteLLM is the sole provider — it proxies the upstream LLM providers itself.
// The single-value enum tags each model entry with its provider; it is not a
// request input (clients no longer send a provider field).
export const modelProviderIdSchema = z.enum(['litellm']).meta({ id: 'ModelProviderId' })

export type ModelProviderId = z.infer<typeof modelProviderIdSchema>

export type LiteLLMBaseUrlRejectionReason =
  | 'invalid-url'
  | 'non-https'
  | 'forbidden-url-parts'
  | 'not-allowed'

export type LiteLLMBaseUrlPolicyResult =
  | { ok: true; url: URL; canonicalUrl: string }
  | { ok: false; reason: LiteLLMBaseUrlRejectionReason }

export interface ValidateLiteLLMBaseUrlPolicyOptions {
  allowedBaseUrls?: ReadonlySet<string> | readonly string[]
  canonicalize?: (url: URL) => string
}

const includesLiteLLMBaseUrl = (
  allowedBaseUrls: ReadonlySet<string> | readonly string[],
  baseUrl: string
): boolean =>
  'has' in allowedBaseUrls ? allowedBaseUrls.has(baseUrl) : allowedBaseUrls.includes(baseUrl)

export const validateLiteLLMBaseUrlPolicy = (
  value: string | null | undefined,
  options: ValidateLiteLLMBaseUrlPolicyOptions = {}
): LiteLLMBaseUrlPolicyResult => {
  const trimmed = value?.trim()
  if (!trimmed) return { ok: false, reason: 'invalid-url' }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'invalid-url' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'non-https' }
  }
  if (url.username || url.password || url.search || url.hash) {
    return { ok: false, reason: 'forbidden-url-parts' }
  }

  const canonicalUrl = options.canonicalize?.(url) ?? url.href
  if (options.allowedBaseUrls && !includesLiteLLMBaseUrl(options.allowedBaseUrls, canonicalUrl)) {
    return { ok: false, reason: 'not-allowed' }
  }

  return { ok: true, url, canonicalUrl }
}

// Opt-in OpenAI-compatible streaming option. When `include_usage` is set the
// provider appends a final SSE chunk carrying `usage` (prompt/completion tokens)
// after the content stream. The edge forwards this verbatim so the client can
// surface token usage (context-usage gauge); omitting it preserves the prior
// behaviour exactly.
export const streamOptionsSchema = z
  .object({
    include_usage: z.boolean().optional()
  })
  .meta({ id: 'StreamOptions' })

export type StreamOptions = z.infer<typeof streamOptionsSchema>

export const modelsChatRequestSchema = z
  .object({
    model: z.string().optional(),
    litellmBaseUrl: z.string().url().optional(),
    stream: z.boolean().optional(),
    stream_options: streamOptionsSchema.optional(),
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

export const modelKindSchema = z.enum(['chat', 'embedding']).meta({ id: 'ModelKind' })

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
    publisher: z.string().optional(),
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

export type GitHubExchangeResponse = z.infer<typeof githubExchangeResponseSchema>

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
export const DEFAULT_LITELLM_MODEL = 'chatgpt/gpt-5.4'

export const EDGE_ROUTE_PATHS = {
  health: '/health',
  authGithubExchange: '/auth/github/exchange',
  search: '/api/search',
  modelsList: '/api/models/list',
  modelsChat: '/api/models/chat',
  mcpDiscover: '/api/mcp/discover',
  mcpCall: '/api/mcp/call'
} as const

export type EdgeRoutePath = (typeof EDGE_ROUTE_PATHS)[keyof typeof EDGE_ROUTE_PATHS]

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
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens'
] as const

export const EDGE_EXPOSED_HEADERS = [...EDGE_RATE_LIMIT_HEADERS, 'retry-after'] as const
