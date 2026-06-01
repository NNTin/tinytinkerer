#!/usr/bin/env node
// Generates the published Edge OpenAPI doc and the contracts' Zod/types/constants
// from the single canonical source at apps/edge/openapi/tinytinkerer-edge.openapi.json.
//
//   node ./scripts/generate-edge-openapi.mjs           # write outputs
//   node ./scripts/generate-edge-openapi.mjs --check    # fail if outputs are stale
//
// The canonical source is the only file you hand-edit. The two generated outputs
// (docs/openapi/...json and packages/shared/contracts/src/edge.generated.ts) are
// derived and must never be edited by hand.
import { readFile, writeFile } from 'node:fs/promises'
import prettier from 'prettier'

const ROOT = new URL('../', import.meta.url)
const SOURCE_PATH = new URL(
  'apps/edge/openapi/tinytinkerer-edge.openapi.json',
  ROOT
)
const DOCS_PATH = new URL('docs/openapi/tinytinkerer-edge.openapi.json', ROOT)
const GENERATED_TS_PATH = new URL(
  'packages/shared/contracts/src/edge.generated.ts',
  ROOT
)

const checkMode = process.argv.includes('--check')

// Vendor extensions that exist purely to drive codegen. They are stripped from
// the published OpenAPI doc so it reads as clean, portable OpenAPI.
const CODEGEN_EXTENSIONS = new Set([
  'x-route-key',
  'x-schema-const',
  'x-schema-type',
  'x-const-key',
  'x-telemetry',
  'x-rate-limit'
])

// Keys the schema→Zod compiler understands. Anything else fails loudly so the
// generator can never silently emit a schema that drops a constraint.
const SUPPORTED_SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'format',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'additionalProperties',
  '$ref',
  'description'
])

class UnsupportedSchema extends Error {}

const refName = ($ref) => {
  const match = /^#\/components\/schemas\/(.+)$/.exec($ref)
  if (!match) throw new UnsupportedSchema(`Unsupported $ref: ${$ref}`)
  return match[1]
}

const stripExtensions = (value) => {
  if (Array.isArray(value)) return value.map(stripExtensions)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      if (CODEGEN_EXTENSIONS.has(key)) continue
      out[key] = stripExtensions(val)
    }
    return out
  }
  return value
}

const assertSupportedKeys = (node, pointer) => {
  for (const key of Object.keys(node)) {
    if (key.startsWith('x-')) continue
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new UnsupportedSchema(`Unsupported schema key "${key}" at ${pointer}`)
    }
  }
}

const stringExpr = (node, pointer) => {
  let expr = 'z.string()'
  if (node.format === 'uri') expr += '.url()'
  else if (node.format) {
    throw new UnsupportedSchema(
      `Unsupported string format "${node.format}" at ${pointer}`
    )
  }
  if (node.minLength !== undefined) expr += `.min(${node.minLength})`
  if (node.maxLength !== undefined) expr += `.max(${node.maxLength})`
  return expr
}

const numberExpr = (node, isInt) => {
  let expr = isInt ? 'z.number().int()' : 'z.number()'
  if (node.exclusiveMinimum !== undefined) {
    expr += node.exclusiveMinimum === 0 ? '.positive()' : `.gt(${node.exclusiveMinimum})`
  }
  if (node.minimum !== undefined) expr += `.min(${node.minimum})`
  if (node.exclusiveMaximum !== undefined) expr += `.lt(${node.exclusiveMaximum})`
  if (node.maximum !== undefined) expr += `.max(${node.maximum})`
  return expr
}

const arrayConstraints = (node) => {
  let suffix = ''
  if (node.minItems !== undefined) suffix += `.min(${node.minItems})`
  if (node.maxItems !== undefined) suffix += `.max(${node.maxItems})`
  return suffix
}

// Builds a Zod expression for one JSON-Schema node. `consts` maps a component
// schema name to its generated `const` identifier so $refs become references.
const zodExpr = (node, consts, pointer) => {
  if (node === null || typeof node !== 'object') {
    throw new UnsupportedSchema(`Unsupported schema at ${pointer}`)
  }

  if (typeof node.$ref === 'string') {
    const name = refName(node.$ref)
    const constName = consts.get(name)
    if (!constName) {
      throw new UnsupportedSchema(`Unknown $ref target "${name}" at ${pointer}`)
    }
    return constName
  }

  assertSupportedKeys(node, pointer)

  if (node.const !== undefined) {
    return `z.literal(${JSON.stringify(node.const)})`
  }

  if (Array.isArray(node.type)) {
    const nonNull = node.type.filter((entry) => entry !== 'null')
    if (node.type.includes('null') && nonNull.length === 1) {
      const base = zodExpr({ ...node, type: nonNull[0] }, consts, pointer)
      return `${base}.nullable()`
    }
    throw new UnsupportedSchema(
      `Unsupported union type ${JSON.stringify(node.type)} at ${pointer}`
    )
  }

  if (node.enum) {
    if (node.type !== 'string') {
      throw new UnsupportedSchema(`Unsupported non-string enum at ${pointer}`)
    }
    return `z.enum([${node.enum.map((v) => JSON.stringify(v)).join(', ')}])`
  }

  switch (node.type) {
    case 'string':
      return stringExpr(node, pointer)
    case 'integer':
      return numberExpr(node, true)
    case 'number':
      return numberExpr(node, false)
    case 'boolean':
      return 'z.boolean()'
    case 'array':
      if (!node.items) {
        throw new UnsupportedSchema(`Array without items at ${pointer}`)
      }
      return `z.array(${zodExpr(node.items, consts, `${pointer}/items`)})${arrayConstraints(node)}`
    case 'object':
      return objectExpr(node, consts, pointer)
    case undefined:
      if (Object.keys(node).every((key) => key.startsWith('x-'))) {
        return 'z.unknown()'
      }
      throw new UnsupportedSchema(`Schema without a type at ${pointer}`)
    default:
      throw new UnsupportedSchema(`Unsupported type "${node.type}" at ${pointer}`)
  }
}

const objectExpr = (node, consts, pointer) => {
  if (node.properties) {
    const required = new Set(node.required ?? [])
    const fields = Object.entries(node.properties).map(([key, sub]) => {
      let expr = zodExpr(sub, consts, `${pointer}/properties/${key}`)
      if (!required.has(key)) expr += '.optional()'
      return `${JSON.stringify(key)}: ${expr}`
    })
    let expr = `z.object({ ${fields.join(', ')} })`
    if (node.additionalProperties === true) expr += '.loose()'
    else if (node.additionalProperties === false) expr += '.strict()'
    return expr
  }

  if (node.additionalProperties === true) {
    return 'z.record(z.string(), z.unknown())'
  }
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    return `z.record(z.string(), ${zodExpr(node.additionalProperties, consts, `${pointer}/additionalProperties`)})`
  }
  return 'z.object({})'
}

// Orders component schemas so each schema is emitted after every schema it $refs.
const topoSortSchemas = (schemas) => {
  const collectRefs = (node, refs = new Set()) => {
    if (Array.isArray(node)) {
      for (const item of node) collectRefs(item, refs)
    } else if (node && typeof node === 'object') {
      if (typeof node.$ref === 'string') refs.add(refName(node.$ref))
      for (const value of Object.values(node)) collectRefs(value, refs)
    }
    return refs
  }

  const deps = new Map(
    Object.entries(schemas).map(([name, schema]) => [name, collectRefs(schema)])
  )
  const ordered = []
  const visited = new Set()
  const visiting = new Set()

  const visit = (name) => {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new UnsupportedSchema(`Circular schema reference at "${name}"`)
    }
    visiting.add(name)
    for (const dep of deps.get(name) ?? []) {
      if (!schemas[dep]) {
        throw new UnsupportedSchema(`Unknown $ref target "${dep}"`)
      }
      visit(dep)
    }
    visiting.delete(name)
    visited.add(name)
    ordered.push(name)
  }

  for (const name of Object.keys(schemas)) visit(name)
  return ordered
}

const objectLiteral = (entries) =>
  `{\n${entries.map(([key, value]) => `  ${key}: ${value}`).join(',\n')}\n}`

const buildGeneratedSource = async (source) => {
  const schemas = source.components?.schemas ?? {}
  const parameters = source.components?.parameters ?? {}
  const headers = source.components?.headers ?? {}

  const consts = new Map(
    Object.entries(schemas).map(([name, schema]) => {
      const constName = schema['x-schema-const']
      if (!constName) {
        throw new UnsupportedSchema(`Schema "${name}" is missing x-schema-const`)
      }
      return [name, constName]
    })
  )

  const chunks = []
  chunks.push(
    '// AUTO-GENERATED from apps/edge/openapi/tinytinkerer-edge.openapi.json by scripts/generate-edge-openapi.mjs — do not edit.'
  )
  chunks.push("import { z } from 'zod'")

  for (const name of topoSortSchemas(schemas)) {
    const schema = schemas[name]
    const constName = schema['x-schema-const']
    const typeName = schema['x-schema-type']
    if (!typeName) {
      throw new UnsupportedSchema(`Schema "${name}" is missing x-schema-type`)
    }
    chunks.push(
      `export const ${constName} = ${zodExpr(schema, consts, `#/components/schemas/${name}`)}`
    )
    chunks.push(`export type ${typeName} = z.infer<typeof ${constName}>`)
  }

  // Telemetry request headers drive both the wire-name map and the validator.
  const telemetryParams = Object.values(parameters).filter(
    (param) => param['x-telemetry']
  )
  if (telemetryParams.length > 0) {
    chunks.push(
      `export const TELEMETRY_HEADERS = ${objectLiteral(
        telemetryParams.map((param) => [
          param['x-const-key'],
          JSON.stringify(param.name)
        ])
      )} as const`
    )
    const telemetryFields = telemetryParams
      .map(
        (param) =>
          `${JSON.stringify(param['x-const-key'])}: z.string().max(${param.schema.maxLength}).optional()`
      )
      .join(', ')
    chunks.push(
      `export const telemetryHeadersSchema = z.object({ ${telemetryFields} })`
    )
    chunks.push(
      'export type TelemetryHeaders = z.infer<typeof telemetryHeadersSchema>'
    )
  }

  // Route paths, keyed by the per-path x-route-key.
  const routeEntries = Object.entries(source.paths ?? {}).map(([path, item]) => {
    const key = item['x-route-key']
    if (!key) {
      throw new UnsupportedSchema(`Path "${path}" is missing x-route-key`)
    }
    return [key, JSON.stringify(path)]
  })
  chunks.push(`export const EDGE_ROUTE_PATHS = ${objectLiteral(routeEntries)} as const`)
  chunks.push(
    'export type EdgeRoutePath = (typeof EDGE_ROUTE_PATHS)[keyof typeof EDGE_ROUTE_PATHS]'
  )

  // Canonical header-name constants gathered from parameters and response headers.
  const headerNameEntries = []
  for (const param of Object.values(parameters)) {
    if (param['x-const-key']) {
      headerNameEntries.push([param['x-const-key'], JSON.stringify(param.name)])
    }
  }
  for (const [headerName, header] of Object.entries(headers)) {
    if (header['x-const-key']) {
      headerNameEntries.push([header['x-const-key'], JSON.stringify(headerName)])
    }
  }
  chunks.push(
    `export const EDGE_HEADER_NAMES = ${objectLiteral(headerNameEntries)} as const`
  )

  // GitHub Models rate-limit headers (proxied + CORS-exposed), declaration order.
  const rateLimitHeaders = Object.entries(headers)
    .filter(([, header]) => header['x-rate-limit'])
    .map(([headerName]) => headerName)
  chunks.push(
    `export const EDGE_RATE_LIMIT_HEADERS = [\n${rateLimitHeaders
      .map((name) => `  ${JSON.stringify(name)}`)
      .join(',\n')}\n] as const`
  )
  chunks.push(
    "export const EDGE_EXPOSED_HEADERS = [...EDGE_RATE_LIMIT_HEADERS, 'retry-after'] as const"
  )

  const code = chunks.join('\n\n') + '\n'
  return prettier.format(code, {
    parser: 'typescript',
    semi: false,
    singleQuote: true,
    trailingComma: 'none'
  })
}

const buildDocs = (source) =>
  `${JSON.stringify(stripExtensions(source), null, 2)}\n`

const readMaybe = async (url) => {
  try {
    return await readFile(url, 'utf8')
  } catch {
    return null
  }
}

const main = async () => {
  const source = JSON.parse(await readFile(SOURCE_PATH, 'utf8'))
  const docs = buildDocs(source)
  const generatedTs = await buildGeneratedSource(source)

  if (checkMode) {
    const stale = []
    if ((await readMaybe(DOCS_PATH)) !== docs) {
      stale.push('docs/openapi/tinytinkerer-edge.openapi.json')
    }
    if ((await readMaybe(GENERATED_TS_PATH)) !== generatedTs) {
      stale.push('packages/shared/contracts/src/edge.generated.ts')
    }
    if (stale.length > 0) {
      console.error(
        `Edge OpenAPI outputs are stale:\n  ${stale.join('\n  ')}\nRun: pnpm generate:edge-openapi`
      )
      process.exitCode = 1
      return
    }
    console.log('Edge OpenAPI outputs are up to date.')
    return
  }

  await writeFile(DOCS_PATH, docs)
  await writeFile(GENERATED_TS_PATH, generatedTs)
  console.log(
    'Generated docs/openapi/tinytinkerer-edge.openapi.json and packages/shared/contracts/src/edge.generated.ts'
  )
}

try {
  await main()
} catch (error) {
  console.error(
    `generate-edge-openapi failed: ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
}
