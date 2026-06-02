// Builds the published OpenAPI document from the edge route definitions. This is
// the single source of the spec: scripts/generate-edge-openapi.ts calls
// buildOpenApiDocument() and writes the result to
// apps/edge/openapi/tinytinkerer-edge.openapi.json.
//
// Routes are registered here with throwaway handlers purely so their OpenAPI
// metadata lands in the registry — the real handlers live in src/routes/*. This
// keeps document generation free of Workers-only dependencies so it runs under
// tsx/Node.
import { OpenAPIHono } from '@hono/zod-openapi'
import { edgeRoutes } from './routes'

export const buildOpenApiDocument = () => {
  const app = new OpenAPIHono()

  app.openAPIRegistry.registerComponent('securitySchemes', 'BearerToken', {
    type: 'http',
    scheme: 'bearer'
  })

  const noopHandler = () => new Response(null)
  for (const route of edgeRoutes) {
    // Doc-only registration; handlers are attached to the real app in src/routes/*.
    app.openapi(route as never, noopHandler as never)
  }

  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'TinyTinkerer Edge API',
      version: '0.1.0',
      description:
        'OpenAPI contract for the TinyTinkerer edge Worker. This document is auto-generated from the edge code (Hono routes + shared Zod contracts) by scripts/generate-edge-openapi.ts and is the published contract consumed by the frontends. Do not edit it by hand — change the route definitions in apps/edge/src/openapi/routes.ts or the schemas in @tinytinkerer/contracts.'
    },
    servers: [{ url: 'https://api.tiny.nntin.xyz' }],
    security: [{ BearerToken: [] }]
  })
}
