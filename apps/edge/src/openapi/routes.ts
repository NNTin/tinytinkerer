// OpenAPI route definitions for the edge Worker. These createRoute() configs are
// the single description of every operation's path, method, request body,
// documented headers, security, and response shapes. They are consumed twice:
//   - the real app (src/routes/*) attaches handlers via app.openapi(route, handler)
//   - the doc generator (src/openapi/document.ts) registers them to emit the spec
//
// This module imports ONLY the shared contracts and @hono/zod-openapi so it stays
// free of Workers-only dependencies (Sentry, the MCP SDK) and can run under tsx
// during `pnpm generate:edge-openapi`.
import { createRoute, z } from '@hono/zod-openapi'
import {
  EDGE_RATE_LIMIT_HEADERS,
  EDGE_ROUTE_PATHS,
  TELEMETRY_HEADERS,
  edgeErrorResponseSchema,
  githubExchangeRequestSchema,
  githubExchangeResponseSchema,
  mcpCallRequestSchema,
  mcpCallResponseSchema,
  mcpDiscoverRequestSchema,
  mcpDiscoveryResultSchema,
  modelsChatRequestSchema,
  modelsChatResponseSchema,
  modelsListResponseSchema,
  rateLimitPayloadSchema,
  requestedModelProviderIdSchema,
  searchRequestSchema,
  searchResponseSchema,
  systemStatusSchema
} from '@tinytinkerer/contracts'

// Telemetry headers are documentation only: optional, unconstrained strings so
// they never cause request validation to reject a call (the telemetry middleware
// reads and length-bounds them separately). Keys are the wire header names.
const telemetryHeaders = z.object({
  [TELEMETRY_HEADERS.appVersion]: z.string().optional(),
  [TELEMETRY_HEADERS.buildHash]: z.string().optional(),
  [TELEMETRY_HEADERS.installId]: z.string().optional(),
  [TELEMETRY_HEADERS.githubId]: z.string().optional()
})

const retryAfterHeader = z.object({
  'Retry-After': z.string().optional()
})

// All upstream rate-limit headers the proxy forwards on chat completions.
const rateLimitForwardHeaders = z.object(
  Object.fromEntries(
    EDGE_RATE_LIMIT_HEADERS.map((name) => [name, z.string().optional()])
  )
)

// Subset surfaced alongside a 429 (mirrors the request-scoped counters + Retry-After).
const rateLimitedResponseHeaders = z.object({
  'Retry-After': z.string().optional(),
  'x-ratelimit-limit-requests': z.string().optional(),
  'x-ratelimit-remaining-requests': z.string().optional(),
  'x-ratelimit-reset-requests': z.string().optional()
})

const jsonBody = <T extends z.ZodType>(schema: T, description?: string) => ({
  required: true,
  content: { 'application/json': { schema } },
  ...(description ? { description } : {})
})

const json = <T extends z.ZodType>(schema: T) => ({
  'application/json': { schema }
})

const errorResponse = (description: string) => ({
  description,
  content: json(edgeErrorResponseSchema)
})

// Upstream (LiteLLM) failures the proxy can surface on either models route.
// The handlers map any unrecognised upstream status to 502, but can pass these
// through, so all are documented as { error } responses.
const upstreamErrorResponses = {
  400: errorResponse('Bad request'),
  401: errorResponse('Unauthorized'),
  403: errorResponse('Forbidden'),
  422: errorResponse('Unprocessable request'),
  500: errorResponse('Upstream error'),
  502: errorResponse('Bad gateway'),
  503: errorResponse('Upstream unavailable'),
  504: errorResponse('Upstream timed out')
}

export const healthRoute = createRoute({
  method: 'get',
  path: EDGE_ROUTE_PATHS.health,
  summary: 'Report edge service health',
  security: [],
  responses: {
    200: {
      description: 'Service status',
      content: json(systemStatusSchema)
    }
  }
})

export const authExchangeRoute = createRoute({
  method: 'post',
  path: EDGE_ROUTE_PATHS.authGithubExchange,
  summary: 'Exchange a GitHub OAuth code for an access token',
  request: {
    headers: telemetryHeaders,
    body: jsonBody(githubExchangeRequestSchema)
  },
  responses: {
    200: {
      description: 'Access token or error',
      content: json(githubExchangeResponseSchema)
    },
    400: {
      description: 'Invalid code or failed exchange',
      content: json(githubExchangeResponseSchema)
    },
    501: {
      description: 'OAuth not configured',
      content: json(githubExchangeResponseSchema)
    }
  }
})

export const searchRoute = createRoute({
  method: 'post',
  path: EDGE_ROUTE_PATHS.search,
  summary: 'Proxy a Tavily web search',
  request: {
    headers: telemetryHeaders,
    body: jsonBody(searchRequestSchema)
  },
  responses: {
    200: {
      description: 'Search results',
      content: json(searchResponseSchema)
    },
    400: errorResponse('Invalid request'),
    401: {
      description: 'Unauthorized',
      content: json(edgeErrorResponseSchema)
    },
    502: { description: 'Bad gateway', content: json(edgeErrorResponseSchema) },
    503: {
      description: 'Search unavailable',
      content: json(edgeErrorResponseSchema)
    }
  }
})

export const modelsListRoute = createRoute({
  method: 'get',
  path: EDGE_ROUTE_PATHS.modelsList,
  summary: 'List models through the edge proxy',
  request: {
    headers: telemetryHeaders,
    query: z.object({
      provider: requestedModelProviderIdSchema.optional(),
      litellmBaseUrl: z.string().url().optional()
    })
  },
  responses: {
    200: {
      description: 'Model catalog',
      content: json(modelsListResponseSchema)
    },
    ...upstreamErrorResponses,
    503: {
      description: 'Catalogue temporarily unavailable',
      headers: retryAfterHeader,
      content: json(edgeErrorResponseSchema)
    }
  }
})

export const modelsChatRoute = createRoute({
  method: 'post',
  path: EDGE_ROUTE_PATHS.modelsChat,
  summary: 'Proxy a provider chat completion',
  request: {
    headers: telemetryHeaders,
    body: jsonBody(modelsChatRequestSchema)
  },
  responses: {
    200: {
      description: 'Chat completion (JSON) or Server-Sent Events stream',
      headers: rateLimitForwardHeaders,
      content: {
        'application/json': { schema: modelsChatResponseSchema },
        'text/event-stream': { schema: z.string() }
      }
    },
    ...upstreamErrorResponses,
    429: {
      description: 'Rate limited',
      headers: rateLimitedResponseHeaders,
      content: json(rateLimitPayloadSchema)
    }
  }
})

export const mcpDiscoverRoute = createRoute({
  method: 'post',
  path: EDGE_ROUTE_PATHS.mcpDiscover,
  summary: 'Discover tools exposed by an MCP server',
  request: {
    headers: telemetryHeaders,
    body: jsonBody(mcpDiscoverRequestSchema)
  },
  responses: {
    200: {
      description: 'Discovered tools',
      content: json(mcpDiscoveryResultSchema)
    },
    400: { description: 'Bad request', content: json(edgeErrorResponseSchema) },
    401: {
      description: 'Unauthorized',
      content: json(edgeErrorResponseSchema)
    },
    502: { description: 'Bad gateway', content: json(edgeErrorResponseSchema) }
  }
})

export const mcpCallRoute = createRoute({
  method: 'post',
  path: EDGE_ROUTE_PATHS.mcpCall,
  summary: 'Invoke a tool on an MCP server',
  request: {
    headers: telemetryHeaders,
    body: jsonBody(mcpCallRequestSchema)
  },
  responses: {
    200: { description: 'Tool result', content: json(mcpCallResponseSchema) },
    400: { description: 'Bad request', content: json(edgeErrorResponseSchema) },
    401: {
      description: 'Unauthorized',
      content: json(edgeErrorResponseSchema)
    },
    502: { description: 'Bad gateway', content: json(edgeErrorResponseSchema) }
  }
})

export const edgeRoutes = [
  healthRoute,
  authExchangeRoute,
  searchRoute,
  modelsListRoute,
  modelsChatRoute,
  mcpDiscoverRoute,
  mcpCallRoute
] as const
