// Performance budget gate for /docs (issue #457): "ordinary content pages must
// not load lab bundles". Runs against the ALREADY-BUILT `apps/docs/build`
// output (the docs build is a dependency of `turbo run build`, which the CI
// "Build" task runs before this script), not the source tree — the guarantee
// this enforces is about what a browser actually fetches, which only the
// compiled artifact can answer.
//
// Every live lab (PixelAgentsLab, ExecutionTraceLab, PluginToolPickerLab, the
// rich-content playground) funnels its heavy product-runtime dependency
// through exactly one module, apps/docs/src/live-lab/client-runtime.tsx,
// itself only ever reachable via `React.lazy` behind Docusaurus's
// `<BrowserOnly>` (enforced at the SOURCE level by
// live-lab/__tests__/static-safety.test.ts). If that invariant holds, the
// compiled chunk containing client-runtime.tsx's code must never be an EAGER
// dependency of any page — it should only ever be fetched at runtime, on
// demand, once a `<LiveLab>` actually mounts in a browser.
//
// This script finds that chunk by a content marker (a string literal unique to
// client-runtime.tsx, so it survives minification) rather than a chunk
// id/filename, which webpack reassigns on every build. It then asserts the
// chunk's filename appears in NO built HTML page's `<script>`/`<link>` tags —
// the only way it could is if some page (docs or otherwise) started eagerly
// importing the live-lab framework instead of reaching it through
// `<BrowserOnly>` + `React.lazy`.
//
// Since issue #481 this script ALSO enforces byte budgets for the load profiles
// a built artifact can answer on its own. The profiles, their numbers, and the
// reasoning behind each are in `config/docs-performance-budget.json` — one
// checked-in table, shared with the browser-side sequencing spec
// (packages/e2e/tests/docs/assistant-performance.e2e.ts) so the two halves of
// "what does the assistant cost, and when" cannot drift apart.
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const rootDir = process.cwd()
const buildDir = join(rootDir, 'apps/docs/build')
// Resolved from this script rather than from the cwd, unlike `buildDir`: the
// build under test is whatever the caller points at (the test harness runs the
// checker against fixture trees in a temp directory), but the budget table is
// this repository's, always.
const budgetPath = fileURLToPath(new URL('../config/docs-performance-budget.json', import.meta.url))

// Each entry is one lazily-loaded product-runtime door, identified by a string
// literal unique to the module behind it (so it survives minification, unlike a
// chunk id or filename, which webpack reassigns on every build).
//
// The live-lab marker comes from client-runtime.tsx's error fallback, chosen
// because it does not appear in any of the "light" always-loaded files
// (LiveLab.tsx's own fallback text is deliberately different: "Preparing the
// live lab session…" alone, shared verbatim between the two, would match both).
//
// The assistant marker (issue #479) matters more, not less: its host is mounted
// from `@theme/Root`, which EVERY documentation page loads. A static import
// anywhere on the path from Root to the runtime would put app-browser in every
// page's initial HTML — which is precisely what this check exists to catch.
const RUNTIME_CHUNKS = [
  {
    label: 'live-lab client-runtime',
    source: 'apps/docs/src/live-lab/client-runtime.tsx',
    marker: 'Failed to start the live lab session.'
  },
  {
    label: 'documentation assistant runtime',
    source: 'apps/docs/src/docs-runtime/assistant-runtime-client.tsx',
    marker: 'Failed to start the documentation assistant session.'
  }
]

/**
 * Bytes of every JS/CSS file a built page references from its own markup.
 *
 * Read from the HTML rather than from a webpack stats file: this is the set a
 * browser fetches to render the page, which is the thing the budget is about.
 * A reference that resolves to no file is reported rather than skipped — a
 * broken asset path silently shrinking the measured total would be a budget
 * that passes precisely when the site is broken.
 */
const pageAssetBytes = async (html, buildRoot) => {
  const referenced = new Set(
    [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1])
  )
  let bytes = 0
  const missing = []
  for (const reference of referenced) {
    // Built pages carry base-URL-prefixed absolute paths (`/docs/assets/…`) and
    // the build root IS that base, so the prefix has to come off — but a deploy
    // base (`/tinytinkerer/docs/`) makes it more than one segment, and the path
    // is already root-relative when the site is served from `/`. Rather than
    // reconstructing the configured base here, try the longest match first and
    // walk leading segments off until something resolves.
    const segments = reference.replace(/^\//, '').split('/')
    let size = null
    for (let skip = 0; skip < segments.length && size === null; skip += 1) {
      try {
        size = (await stat(join(buildRoot, segments.slice(skip).join('/')))).size
      } catch {
        // Not at this depth; try the next.
      }
    }
    if (size === null) missing.push(reference)
    else bytes += size
  }
  return { bytes, missing }
}

const formatBytes = (value) => `${value.toLocaleString('en-US')} bytes`

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)))
    } else {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * The three load profiles a built artifact can weigh on its own (issue #481).
 *
 * Profile 2 (opening the assistant) is deliberately absent: which chunks an
 * activation pulls is a property of webpack's runtime chunk graph, and a static
 * approximation of it would be a number nobody could reproduce. The e2e spec
 * measures it from a real browser against the same table.
 */
const checkByteBudgets = async (allFiles, htmlContents) => {
  const { profiles } = JSON.parse(await readFile(budgetPath, 'utf8'))
  const breaches = []
  const measured = []

  const record = (key, actual, detail) => {
    const profile = profiles[key]
    measured.push(`${key}: ${formatBytes(actual)} / ${formatBytes(profile.maxBytes)}${detail}`)
    if (actual > profile.maxBytes) {
      breaches.push(
        `  - ${profile.label}\n` +
          `    ${formatBytes(actual)} exceeds the ${formatBytes(profile.maxBytes)} budget${detail}\n` +
          `    ${profile.note}`
      )
    }
  }

  // --- 1. Cold documentation page ------------------------------------------
  //
  // The HEAVIEST built page, not a representative one. A budget that a reader
  // can exceed by visiting a different route is not a budget.
  const manifests = allFiles.filter((file) =>
    /assets\/docs-corpus\/manifest\.v\d+\..+\.json$/.test(file)
  )
  if (manifests.length !== 1) {
    throw new Error(
      `Expected exactly one corpus manifest in ${relative(rootDir, buildDir)}, found ${manifests.length}. ` +
        `The corpus plugin emits one per build (see apps/docs/src/docs-corpus/README.md).`
    )
  }
  const manifestBytes = (await stat(manifests[0])).size

  let heaviest = { page: null, bytes: 0 }
  for (const [htmlPath, html] of htmlContents) {
    // `upstream/` is the vendored Pixel Agents bundle, copied in whole through
    // `staticDirectories` — a separate application with its own relative asset
    // paths, served inside a sandboxed iframe. It is not a documentation page
    // and no reader loads it by browsing docs, so it is not this profile's.
    if (htmlPath.includes('/build/upstream/')) continue
    const { bytes, missing } = await pageAssetBytes(html, buildDir)
    if (missing.length > 0) {
      throw new Error(
        `${relative(rootDir, htmlPath)} references assets that are not in the build: ` +
          `${missing.join(', ')}. The budget cannot be measured against a broken page.`
      )
    }
    if (bytes > heaviest.bytes) heaviest = { page: relative(rootDir, htmlPath), bytes }
  }
  record(
    'coldPage',
    heaviest.bytes + manifestBytes,
    ` (${relative(rootDir, heaviest.page ?? '')} + a ${formatBytes(manifestBytes)} manifest)`
  )

  // --- 3. First document read ----------------------------------------------
  const artifacts = allFiles.filter((file) => file.includes('assets/docs-corpus/documents/'))
  if (artifacts.length === 0) {
    throw new Error(
      `No per-document corpus artifacts in ${relative(rootDir, buildDir)}. Either the build is ` +
        `stale or the corpus plugin stopped emitting them.`
    )
  }
  let largest = { file: null, bytes: 0 }
  for (const artifact of artifacts) {
    const { size } = await stat(artifact)
    if (size > largest.bytes) largest = { file: artifact.split('/').pop(), bytes: size }
  }
  record('documentRead', largest.bytes, ` (largest of ${artifacts.length}: ${largest.file})`)

  // --- 4. First search ------------------------------------------------------
  //
  // Finding this file at all is the production-build smoke check: the upstream
  // plugin writes it only from `postBuild`, so a build that stopped emitting it
  // would leave the assistant reporting search as permanently unavailable in
  // production while every unit test stayed green.
  const searchIndex = allFiles.find((file) => file.endsWith('/search-index.json'))
  if (!searchIndex) {
    throw new Error(
      `No search-index.json in ${relative(rootDir, buildDir)}. The local-search plugin writes it ` +
        `from its production postBuild hook — without it, search_docs reports the index as ` +
        `unavailable on the deployed site (see apps/docs/src/docs-search/README.md).`
    )
  }
  record('search', (await stat(searchIndex)).size, ' (search-index.json)')

  if (breaches.length > 0) {
    throw new Error(
      `Performance budget violated. Each figure below is a checked-in baseline in ` +
        `config/docs-performance-budget.json — raise one only with a reason:\n${breaches.join('\n')}`
    )
  }

  console.log(`Load profiles within budget:\n  ${measured.join('\n  ')}`)
}

const main = async () => {
  let allFiles
  try {
    allFiles = await walk(buildDir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `${relative(rootDir, buildDir)} does not exist. Run \`pnpm --filter @tinytinkerer/docs build\` (or the full \`pnpm build\`) before this check.`
      )
    }
    throw error
  }

  const jsFiles = allFiles.filter((file) => file.endsWith('.js'))
  const htmlFiles = allFiles.filter((file) => file.endsWith('.html'))

  if (jsFiles.length === 0 || htmlFiles.length === 0) {
    throw new Error(`${relative(rootDir, buildDir)} looks incomplete (no .js or .html output).`)
  }

  const jsContents = new Map()
  for (const file of jsFiles) {
    jsContents.set(file, await readFile(file, 'utf8'))
  }
  const htmlContents = new Map()
  for (const file of htmlFiles) {
    htmlContents.set(file, await readFile(file, 'utf8'))
  }

  const violations = []
  const summaries = []

  for (const { label, source, marker } of RUNTIME_CHUNKS) {
    const chunks = jsFiles.filter((file) => jsContents.get(file).includes(marker))

    if (chunks.length === 0) {
      throw new Error(
        `Could not find the ${label} chunk in ${relative(rootDir, buildDir)} ` +
          `(searched for the marker ${JSON.stringify(marker)}). ` +
          `Either the build is stale, or ${source} changed and this check needs a new marker.`
      )
    }

    for (const chunkPath of chunks) {
      const chunkName = chunkPath.split('/').pop()
      for (const [htmlPath, html] of htmlContents) {
        if (html.includes(chunkName)) {
          violations.push({ label, chunkName, page: relative(rootDir, htmlPath) })
        }
      }
    }

    summaries.push(`${chunks.length} ${label} chunk(s)`)
  }

  if (violations.length > 0) {
    const lines = violations.map(
      (v) => `  - ${v.page} eagerly references ${v.chunkName} (${v.label})`
    )
    throw new Error(
      `Performance budget violated: a product-runtime chunk must only be fetched on demand ` +
        `(React.lazy behind <BrowserOnly>), never referenced from a page's initial ` +
        `HTML:\n${lines.join('\n')}`
    )
  }

  await checkByteBudgets(allFiles, htmlContents)

  console.log(
    `Performance budget OK: ${summaries.join(' and ')} are absent from all ` +
      `${htmlFiles.length} built docs page(s).`
  )
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}
