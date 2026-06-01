#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)
const GITHUB_SPEC_PATH = new URL(
  'docs/openapi/github-models.openapi.json',
  ROOT
)
const CATALOG_PATH = new URL(
  'packages/app/app-core/src/github-models-catalog.json',
  ROOT
)

const DOCS_PAGES = [
  'https://docs.github.com/en/rest/models/catalog',
  'https://docs.github.com/en/rest/models/inference',
  'https://docs.github.com/en/rest/models/embeddings'
]

const CATALOG_URL = 'https://models.github.ai/catalog/models'
const updateCatalog = process.argv.includes('--update-catalog')

const readJson = async (url) => JSON.parse(await readFile(url, 'utf8'))

const fail = (message) => {
  console.error(`GitHub Models OpenAPI check failed: ${message}`)
  process.exitCode = 1
}

const assertEqual = (label, actual, expected) => {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    fail(`${label}\nexpected: ${expectedJson}\nactual:   ${actualJson}`)
  }
}

const fetchText = async (url, init) => {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status} ${response.statusText}`)
  }
  return response.text()
}

const fetchJson = async (url, init) => JSON.parse(await fetchText(url, init))

const extractNextData = (html, url) => {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  )
  if (!match?.[1])
    throw new Error(`Unable to find GitHub Docs structured data in ${url}`)
  return JSON.parse(match[1])
}

const fetchDocsOperations = async () => {
  const operations = []
  for (const page of DOCS_PAGES) {
    const html = await fetchText(page)
    const data = extractNextData(html, page)
    operations.push(...(data.props?.pageProps?.restOperations ?? []))
  }
  return operations.map((operation) => ({
    method: operation.verb,
    path: operation.requestPath,
    serverUrl: operation.serverUrl,
    parameters: (operation.parameters ?? []).map((parameter) => ({
      in: parameter.in,
      name: parameter.name,
      required: parameter.required === true
    })),
    bodyParameters: (operation.bodyParameters ?? []).map((parameter) => ({
      name: parameter.name,
      required: parameter.isRequired === true,
      enum: parameter.enum ?? []
    })),
    statuses: (operation.statusCodes ?? [])
      .map((status) => String(status.httpStatusCode))
      .sort()
  }))
}

const resolveRef = (spec, value) => {
  if (!value?.$ref) return value
  const [, pointer] = value.$ref.split('#/')
  return pointer.split('/').reduce((current, part) => current?.[part], spec)
}

const requestSchemaFor = (spec, operation) => {
  const schema = operation.requestBody?.content?.['application/json']?.schema
  return resolveRef(spec, schema) ?? {}
}

const operationFromSpec = (spec, path, method) => {
  const operation = spec.paths?.[path]?.[method]
  if (!operation)
    throw new Error(`Spec is missing ${method.toUpperCase()} ${path}`)
  return operation
}

const normalizeSpecParameters = (spec, parameters = []) =>
  parameters.map((parameter) => {
    const resolved = resolveRef(spec, parameter)
    return {
      in: resolved.in,
      name: resolved.name,
      required: resolved.required === true
    }
  })

const checkGitHubOpenApi = async () => {
  const spec = await readJson(GITHUB_SPEC_PATH)
  const operations = await fetchDocsOperations()

  assertEqual(
    'GitHub Models server URL',
    spec.servers?.map((server) => server.url),
    ['https://models.github.ai']
  )

  for (const docsOperation of operations) {
    const specOperation = operationFromSpec(
      spec,
      docsOperation.path,
      docsOperation.method
    )
    assertEqual(
      `${docsOperation.method.toUpperCase()} ${docsOperation.path} parameters`,
      normalizeSpecParameters(spec, specOperation.parameters ?? []),
      docsOperation.parameters
    )
    assertEqual(
      `${docsOperation.method.toUpperCase()} ${docsOperation.path} status codes`,
      Object.keys(specOperation.responses ?? {}).sort(),
      docsOperation.statuses
    )

    if (docsOperation.bodyParameters.length > 0) {
      const schema = requestSchemaFor(spec, specOperation)
      assertEqual(
        `${docsOperation.method.toUpperCase()} ${docsOperation.path} body fields`,
        Object.keys(schema.properties ?? {}).sort(),
        docsOperation.bodyParameters.map((parameter) => parameter.name).sort()
      )
      assertEqual(
        `${docsOperation.method.toUpperCase()} ${docsOperation.path} required body fields`,
        [...(schema.required ?? [])].sort(),
        docsOperation.bodyParameters
          .filter((parameter) => parameter.required)
          .map((parameter) => parameter.name)
          .sort()
      )
    }
  }
}

const inferModelKind = (model) =>
  model.id.includes('/text-embedding') || model.tags?.includes('embedding')
    ? 'embedding'
    : 'chat'

const definedEntries = (record) =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  )

const normalizeCatalog = (models) =>
  models
    .map((model) =>
      definedEntries({
        id: model.id,
        label: model.name ?? model.id,
        kind: inferModelKind(model),
        name: model.name,
        publisher: model.publisher,
        registry: model.registry,
        summary: model.summary,
        html_url: model.html_url,
        version: model.version,
        capabilities: model.capabilities,
        limits: model.limits,
        rate_limit_tier: model.rate_limit_tier,
        supported_input_modalities: model.supported_input_modalities,
        supported_output_modalities: model.supported_output_modalities,
        tags: model.tags
      })
    )
    .sort((a, b) => a.id.localeCompare(b.id))

const fetchLiveCatalog = async () => {
  const token = process.env.GITHUB_MODELS_TOKEN
  if (token) {
    return fetchJson(CATALOG_URL, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2026-03-10'
      }
    })
  }

  if (process.env.GITHUB_MODELS_USE_GH_CLI === '1') {
    const raw = execFileSync(
      'gh',
      [
        'api',
        CATALOG_URL,
        '-H',
        'Accept: application/vnd.github+json',
        '-H',
        'X-GitHub-Api-Version: 2026-03-10'
      ],
      { encoding: 'utf8' }
    )
    return JSON.parse(raw)
  }

  throw new Error('GITHUB_MODELS_TOKEN is required for the live catalog audit')
}

const checkCatalog = async () => {
  const liveCatalog = normalizeCatalog(await fetchLiveCatalog())
  const checkedInCatalog = await readJson(CATALOG_PATH)

  if (updateCatalog) {
    await writeFile(CATALOG_PATH, `${JSON.stringify(liveCatalog, null, 2)}\n`)
    console.log(
      `Updated ${CATALOG_PATH.pathname} with ${liveCatalog.length} models.`
    )
    return
  }

  assertEqual('GitHub Models catalog', checkedInCatalog, liveCatalog)
}

// The TinyTinkerer edge OpenAPI spec is generated from its canonical source and
// verified separately by `pnpm check:edge-openapi` (scripts/generate-edge-openapi.mjs).

try {
  await checkGitHubOpenApi()
  await checkCatalog()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

if (!process.exitCode) {
  console.log('GitHub Models OpenAPI and catalog are up to date.')
}
