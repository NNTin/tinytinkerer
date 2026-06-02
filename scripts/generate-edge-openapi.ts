#!/usr/bin/env tsx
// Generates the published Edge OpenAPI document from the edge code.
//
//   pnpm generate:edge-openapi          # write the document
//   pnpm check:edge-openapi             # fail if the document is stale
//
// The document is built from apps/edge/src/openapi/routes.ts (route definitions)
// and the shared Zod schemas in @tinytinkerer/contracts. It is the single,
// generated source of truth for the edge HTTP contract and must never be edited
// by hand.
import { readFile, writeFile } from 'node:fs/promises'
import { buildOpenApiDocument } from '../apps/edge/src/openapi/document'

const OUTPUT_PATH = new URL(
  '../apps/edge/openapi/tinytinkerer-edge.openapi.json',
  import.meta.url
)

const checkMode = process.argv.includes('--check')

const main = async () => {
  const document = buildOpenApiDocument()
  const serialized = `${JSON.stringify(document, null, 2)}\n`

  if (checkMode) {
    let current: string | null = null
    try {
      current = await readFile(OUTPUT_PATH, 'utf8')
    } catch {
      current = null
    }
    if (current !== serialized) {
      console.error(
        'Edge OpenAPI document is stale: apps/edge/openapi/tinytinkerer-edge.openapi.json\nRun: pnpm generate:edge-openapi'
      )
      process.exitCode = 1
      return
    }
    console.log('Edge OpenAPI document is up to date.')
    return
  }

  await writeFile(OUTPUT_PATH, serialized)
  console.log('Generated apps/edge/openapi/tinytinkerer-edge.openapi.json')
}

main().catch((error) => {
  console.error(
    `generate-edge-openapi failed: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
