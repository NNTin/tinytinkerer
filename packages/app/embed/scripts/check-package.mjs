/**
 * Post-build guard for the published package (issue #510, T1). Fails the build
 * if any of the package's promises to a host stops holding:
 *
 * 1. **No leaking dependencies.** The manifest declares no `dependencies`, its
 *    peers are exactly `react` and `react-dom`, and neither the bundle nor the
 *    declaration tree imports any other bare specifier.
 * 2. **Heavy code stays lazy.** The entry's STATIC import graph — what a host
 *    pays the moment its own `import()` of this package resolves — contains no
 *    plugin and no content renderer (each sits behind a dynamic `import()` in
 *    the workspace), every catalogue plugin is its own chunk, and the static
 *    graph stays under a byte budget.
 * 3. **The stylesheets exist**, and `embed.css` is still scoped.
 * 4. **The `/oauth` subpath is light** (issue #518, F3). A host imports it from
 *    its EAGER entry, so its static graph must stay a few kilobytes: no peer
 *    (React), no chunk the runtime entry also needs beyond the one small chunk
 *    the two share.
 *
 * The JavaScript checks read the chunk graph the bundler itself recorded
 * (`.build/bundle-graph.json`, written by vite.config.ts) rather than
 * re-parsing its output: bundled parsers are full of strings and comments that
 * look like imports. Declarations are scanned with the TypeScript compiler's
 * own pre-processor, for the same reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(packageDir, 'dist')
const failures = []

const PEER_SPECIFIER = /^react(-dom)?(\/.*)?$/

// Headroom over the measured entry graph (~2.6 MB unminified; the build log
// line below prints it). The point is to catch a heavy module — mermaid alone
// is megabytes — being pulled onto the static path, not to police kilobytes.
const STATIC_GRAPH_BUDGET_BYTES = 3_000_000

// The `/oauth` subpath's whole static graph (~5 KB unminified when written).
// Anything near this means a runtime module — the telemetry client, Zod, a
// store — leaked into what a host pays at startup.
const OAUTH_GRAPH_BUDGET_BYTES = 16_000

// Chunks that must only ever be reached lazily: exactly the code that sits
// behind a dynamic import() in the workspace itself. Every catalogue plugin and
// the mermaid and wireframe renderers are named after their package by
// vite.config.ts; prettier (the code formatter) keeps its own module names.
//
// NOT on this list, deliberately: content-code (CodeMirror). It is static in
// every deployable shell too — the turn-activity panel, context inspector and
// permission modal all import its ReadOnlyCodeView eagerly (see
// app-browser/src/assistant-content.tsx) — so a host pays for it when its own
// import() of this package resolves, exactly as the documentation site's
// lazily-loaded runtime chunk does.
const LAZY_ONLY_CHUNK =
  /^(plugin-[a-z-]+|content-mermaid|content-wireframe|standalone|babel|estree)-[\w-]+\.js$/
const CATALOGUE_PLUGINS = [
  'plugin-browser-state',
  'plugin-choice-prompt',
  'plugin-code-exec',
  'plugin-context-inspector',
  'plugin-context-usage',
  'plugin-event-logger',
  'plugin-feedback',
  'plugin-permissions',
  'plugin-tool-tree',
  'plugin-web-search'
]

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })

// ── 1. manifest ─────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const runtimeDependencies = Object.keys(manifest.dependencies ?? {})
if (runtimeDependencies.length > 0) {
  failures.push(
    `package.json declares runtime dependencies (${runtimeDependencies.join(', ')}); bundle them instead`
  )
}
const peers = Object.keys(manifest.peerDependencies ?? {}).sort()
if (peers.join(',') !== 'react,react-dom') {
  failures.push(`peerDependencies must be exactly react and react-dom, got ${peers.join(', ')}`)
}

// ── 1. bundle imports ───────────────────────────────────────────────────────
/** @type {Record<string, { imports: string[], dynamicImports: string[], bytes: number }>} */
const graph = JSON.parse(readFileSync(join(packageDir, '.build/bundle-graph.json'), 'utf8'))
for (const [chunk, { imports, dynamicImports }] of Object.entries(graph)) {
  for (const specifier of [...imports, ...dynamicImports]) {
    if (!(specifier in graph) && !PEER_SPECIFIER.test(specifier)) {
      failures.push(`${chunk} imports "${specifier}", which a host would have to install`)
    }
  }
}

// ── 1. declaration imports ──────────────────────────────────────────────────
const files = walk(distDir)
const declarationFiles = files.filter((path) => /\.d\.[cm]?ts$/.test(path))
for (const path of declarationFiles) {
  const text = readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const specifiers = ts
    .preProcessFile(text, true, true)
    .typeReferenceDirectives.map((ref) => ref.fileName)
  const visit = (node) => {
    const literal =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
          ? node.argument.literal
          : undefined
    if (literal && ts.isStringLiteralLike(literal)) {
      specifiers.push(literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.') && !PEER_SPECIFIER.test(specifier)) {
      failures.push(
        `${relative(packageDir, path)} imports "${specifier}", which a host would have to install`
      )
    }
  }
}

// ── 2. the entry's static graph ─────────────────────────────────────────────
/** Every chunk an entry's static imports reach, and every bare specifier among them. */
const staticClosure = (entry) => {
  const chunks = new Set()
  const bare = new Set()
  const pending = [entry]
  while (pending.length > 0) {
    const chunk = pending.pop()
    if (!(chunk in graph)) {
      bare.add(chunk)
      continue
    }
    if (chunks.has(chunk)) {
      continue
    }
    chunks.add(chunk)
    pending.push(...graph[chunk].imports)
  }
  return { chunks, bare }
}
const staticGraph = staticClosure('index.js').chunks

let staticBytes = 0
for (const chunk of staticGraph) {
  staticBytes += graph[chunk].bytes
  if (LAZY_ONLY_CHUNK.test(basename(chunk))) {
    failures.push(`${chunk} is on the entry's static import graph; it must stay lazy`)
  }
}
if (staticBytes > STATIC_GRAPH_BUDGET_BYTES) {
  failures.push(
    `the entry's static graph is ${staticBytes} bytes, over the ${STATIC_GRAPH_BUDGET_BYTES}-byte budget`
  )
}
const lazyChunks = Object.keys(graph).filter((chunk) => !staticGraph.has(chunk))
for (const plugin of CATALOGUE_PLUGINS) {
  if (!lazyChunks.some((chunk) => basename(chunk).startsWith(`${plugin}-`))) {
    failures.push(`${plugin} was not emitted as its own lazily-loaded chunk`)
  }
}

// ── 2. no inlined assets ────────────────────────────────────────────────────
// Library mode would inline every asset; vite.config.ts opts out. A data: URL
// of more than a few kilobytes anywhere in the bundle means that stopped
// working.
for (const chunk of Object.keys(graph)) {
  const source = readFileSync(join(distDir, chunk), 'utf8')
  if (/data:(?:image|application|font)\/[\w.+-]+;base64,[A-Za-z0-9+/=]{20000}/.test(source)) {
    failures.push(`${chunk} inlines a large asset as a data: URL; it must be emitted as a file`)
  }
}

// ── 3. stylesheets ──────────────────────────────────────────────────────────
for (const name of ['embed.css', 'styles.css']) {
  if (!files.includes(join(distDir, name))) {
    failures.push(`dist/${name} was not emitted`)
  }
}
const embedCss = readFileSync(join(distDir, 'embed.css'), 'utf8')
if (!embedCss.includes(':where(.tt-app-embed)')) {
  failures.push('dist/embed.css is no longer scoped to :where(.tt-app-embed)')
}

// ── 4. the /oauth subpath ───────────────────────────────────────────────────
if (!('oauth.js' in graph)) {
  failures.push('dist/oauth.js was not emitted (the `/oauth` subpath, issue #518 F3)')
} else {
  const oauth = staticClosure('oauth.js')
  const oauthBytes = [...oauth.chunks].reduce((sum, chunk) => sum + graph[chunk].bytes, 0)
  if (oauth.bare.size > 0) {
    failures.push(
      `the /oauth subpath imports ${[...oauth.bare].join(', ')}; it must import nothing a host resolves`
    )
  }
  if (oauthBytes > OAUTH_GRAPH_BUDGET_BYTES) {
    failures.push(
      `the /oauth subpath's static graph is ${oauthBytes} bytes over ${oauth.chunks.size} chunks, ` +
        `over the ${OAUTH_GRAPH_BUDGET_BYTES}-byte budget; a runtime module leaked into it`
    )
  }
  if (graph['oauth.js'].dynamicImports.length > 0) {
    failures.push(
      `the /oauth subpath has dynamic imports (${graph['oauth.js'].dynamicImports.join(', ')}); it must not reach the runtime at all`
    )
  }
  console.log(
    `[embed] /oauth subpath: ${oauth.chunks.size} chunks / ${oauthBytes} bytes on its static graph`
  )
}
for (const name of ['oauth.js', 'oauth.d.ts']) {
  if (!files.includes(join(distDir, name))) {
    failures.push(`dist/${name} was not emitted`)
  }
}

if (failures.length > 0) {
  console.error(`[embed] package check failed:\n  - ${failures.join('\n  - ')}`)
  process.exit(1)
}
console.log(
  `[embed] package check passed: entry static graph ${staticGraph.size} chunks / ${staticBytes} bytes, ` +
    `${lazyChunks.length} lazy chunks, ${declarationFiles.length} declaration files`
)
