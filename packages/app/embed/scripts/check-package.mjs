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
 *    Assets are named relative to the chunk that loads them (issue #518, F2).
 * 3. **The stylesheets exist and stay off the host page** (issue #518, F1): no
 *    shipped selector names `:root` or `:host` or could match outside a
 *    `.tt-app-embed` surface, and every palette token carries the `--tt-`
 *    prefix — in the stylesheets and in the bundle's own class names and inline
 *    styles. scripts/host-isolation.mjs is the model.
 * 4. **The `/oauth` and `/stage` subpaths are light** (issue #518 F3, #523
 *    G1). A host imports them from its EAGER code, so each static graph must
 *    stay a few kilobytes: no peer (React), no dynamic import, no chunk the
 *    runtime entry also needs beyond the small leaf chunks they share.
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
import { rollup } from 'rollup'
import ts from 'typescript'
import { hostLeakingSelectors, unprefixedTokens } from './host-isolation.mjs'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(packageDir, 'dist')
const failures = []

const PEER_SPECIFIER = /^react(-dom)?(\/.*)?$/

// Headroom over the measured entry graph (~1.3 MB unminified since CodeMirror
// went lazy in issue #518, F12 — it was ~2.6 MB; the build log line below
// prints it). The point is to catch a heavy module — CodeMirror is over a
// megabyte, mermaid several — being pulled onto the static path, not to police
// kilobytes.
const STATIC_GRAPH_BUDGET_BYTES = 1_600_000

// The side-effect-free subpaths a host imports from EAGER code, and each one's
// whole static graph budget. `/oauth` measured ~8.6 KB unminified, `/stage`
// ~2 KB. Anything near a budget means a runtime module — the telemetry client,
// Zod, a store — leaked into what a host pays at startup.
const LIGHT_SUBPATHS = [
  { name: 'oauth', issue: '#518 F3', budget: 16_000 },
  { name: 'stage', issue: '#523 G1', budget: 8_000 }
]

// Chunks that must only ever be reached lazily: exactly the code that sits
// behind a dynamic import() in the workspace itself. Every catalogue plugin and
// the code, mermaid and wireframe renderers are named after their package by
// vite.config.ts; prettier (the code formatter) keeps its own module names.
//
// content-code (CodeMirror) joined this list with issue #518, F12: the panels
// that show a tool's code now reach its ReadOnlyCodeView through
// app-browser's LazyReadOnlyCodeView, so a host no longer pays for it the
// moment its own import() of this package resolves.
const LAZY_ONLY_CHUNK =
  /^(plugin-[a-z-]+|content-code|content-mermaid|content-wireframe|standalone|babel|estree)-[\w-]+\.js$/
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

// ── 2. relative asset URLs ──────────────────────────────────────────────────
// An asset named by a root-absolute path ("/assets/x") is a path on the HOST's
// origin that its bundler never sees, so nothing copies the file there (issue
// #518, F2). Every reference must be `new URL('../assets/x', import.meta.url)`.
for (const path of files.filter((file) => /\.(?:js|css)$/.test(file))) {
  const absolute = readFileSync(path, 'utf8').match(/["'`(]\/assets\/[^"'`)\s]+/g)
  if (absolute) {
    failures.push(
      `${relative(packageDir, path)} names assets by root-absolute URL: ${[...new Set(absolute)].map((url) => url.slice(1)).join(', ')}`
    )
  }
}

// ── 2. no stray annotations ─────────────────────────────────────────────────
// A comment that mentions `@__PURE__` without being one makes a host's Rollup
// warn (issue #518, F13); vite.config.ts disarms them. Asked of Rollup itself,
// bundling the whole package the way a host does, because only a real parser
// knows a comment from a string that looks like one.
const rollupWarnings = []
await (
  await rollup({
    input: join(distDir, 'index.js'),
    external: (id) => PEER_SPECIFIER.test(id),
    onwarn: (warning) => rollupWarnings.push(warning)
  })
).close()
for (const warning of rollupWarnings.filter(({ code }) => code === 'INVALID_ANNOTATION')) {
  failures.push(
    `${relative(packageDir, warning.id ?? '')}:${warning.loc?.line ?? '?'} has a comment a host's Rollup misreads as an annotation`
  )
}

// ── 3. stylesheets ──────────────────────────────────────────────────────────
const stylesheets = files.filter((path) => path.endsWith('.css'))
for (const name of ['embed.css', 'styles.css']) {
  if (!stylesheets.includes(join(distDir, name))) {
    failures.push(`dist/${name} was not emitted`)
  }
}
for (const path of stylesheets) {
  const css = readFileSync(path, 'utf8')
  const leaks = [...new Set(hostLeakingSelectors(css))]
  if (leaks.length > 0) {
    failures.push(
      `${relative(packageDir, path)} has selectors that reach the host page: ${leaks.join(' | ')}`
    )
  }
  const unprefixed = unprefixedTokens(css)
  if (unprefixed.length > 0) {
    failures.push(
      `${relative(packageDir, path)} names palette tokens without the --tt- prefix: ${unprefixed.join(', ')}`
    )
  }
}
const embedCss = readFileSync(join(distDir, 'embed.css'), 'utf8')
if (!embedCss.includes(':where(.tt-app-embed)')) {
  failures.push('dist/embed.css is no longer scoped to :where(.tt-app-embed)')
}

// The bundle's own references to the palette: Tailwind arbitrary values
// (`bg-[var(--tt-panel)]`, `bg-(--tt-panel)`) and inline-style keys
// (`'--tt-accent'`). Unprefixed, they would no longer match the stylesheet.
// Bundled third-party code keeps its own names and spells neither shape.
const OWN_TOKEN_REFERENCE = /\[var\(--[\w-]+\)|-\(--[\w-]+\)|["'`]--[\w-]+["'`]/g
for (const chunk of Object.keys(graph)) {
  const source = readFileSync(join(distDir, chunk), 'utf8')
  const references = (source.match(OWN_TOKEN_REFERENCE) ?? []).join(' ')
  const unprefixed = unprefixedTokens(references)
  if (unprefixed.length > 0) {
    failures.push(
      `${chunk} names palette tokens without the --tt- prefix: ${unprefixed.join(', ')}`
    )
  }
}

// ── 4. the light subpaths ───────────────────────────────────────────────────
// `/oauth` (issue #518, F3) and `/stage` (issue #523, G1). A host imports them
// from its EAGER code, so each one's static graph must stay a few kilobytes: no
// peer (React), no dynamic import, nothing the runtime entry also needs beyond
// the small leaf modules the two share.
for (const { name, issue, budget } of LIGHT_SUBPATHS) {
  const entry = `${name}.js`
  if (!(entry in graph)) {
    failures.push(`dist/${entry} was not emitted (the \`/${name}\` subpath, issue ${issue})`)
    continue
  }
  const closure = staticClosure(entry)
  const bytes = [...closure.chunks].reduce((sum, chunk) => sum + graph[chunk].bytes, 0)
  if (closure.bare.size > 0) {
    failures.push(
      `the /${name} subpath imports ${[...closure.bare].join(', ')}; it must import nothing a host resolves`
    )
  }
  if (bytes > budget) {
    failures.push(
      `the /${name} subpath's static graph is ${bytes} bytes over ${closure.chunks.size} chunks, ` +
        `over the ${budget}-byte budget; a runtime module leaked into it`
    )
  }
  const dynamicImports = [...closure.chunks].flatMap((chunk) => graph[chunk].dynamicImports)
  if (dynamicImports.length > 0) {
    failures.push(
      `the /${name} subpath has dynamic imports (${dynamicImports.join(', ')}); it must not reach the runtime at all`
    )
  }
  console.log(
    `[embed] /${name} subpath: ${closure.chunks.size} chunks / ${bytes} bytes on its static graph`
  )
  for (const file of [`${name}.js`, `${name}.d.ts`]) {
    if (!files.includes(join(distDir, file))) {
      failures.push(`dist/${file} was not emitted`)
    }
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
