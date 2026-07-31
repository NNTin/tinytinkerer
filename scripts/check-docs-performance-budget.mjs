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
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const buildDir = join(rootDir, 'apps/docs/build')

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
