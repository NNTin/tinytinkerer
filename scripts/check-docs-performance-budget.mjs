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

// A string literal from client-runtime.tsx's error fallback, chosen because it
// does not appear in any of the "light" always-loaded files (LiveLab.tsx's own
// fallback text is deliberately different: "Preparing the live lab session…"
// alone, shared verbatim between the two, would match both).
const CLIENT_RUNTIME_MARKER = 'Failed to start the live lab session.'

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

  const runtimeChunks = []
  for (const file of jsFiles) {
    const content = await readFile(file, 'utf8')
    if (content.includes(CLIENT_RUNTIME_MARKER)) {
      runtimeChunks.push(file)
    }
  }

  if (runtimeChunks.length === 0) {
    throw new Error(
      `Could not find the live-lab client-runtime chunk in ${relative(rootDir, buildDir)} ` +
        `(searched for the marker ${JSON.stringify(CLIENT_RUNTIME_MARKER)}). ` +
        'Either the build is stale, or client-runtime.tsx changed and this check needs a new marker.'
    )
  }

  const violations = []
  for (const chunkPath of runtimeChunks) {
    const chunkName = chunkPath.split('/').pop()
    for (const htmlPath of htmlFiles) {
      const html = await readFile(htmlPath, 'utf8')
      if (html.includes(chunkName)) {
        violations.push({ chunkName, page: relative(rootDir, htmlPath) })
      }
    }
  }

  if (violations.length > 0) {
    const lines = violations.map((v) => `  - ${v.page} eagerly references ${v.chunkName}`)
    throw new Error(
      `Performance budget violated: the live-lab product-runtime chunk must only be fetched ` +
        `on demand (React.lazy behind <BrowserOnly>), never referenced from a page's initial ` +
        `HTML:\n${lines.join('\n')}`
    )
  }

  console.log(
    `Performance budget OK: ${runtimeChunks.length} live-lab runtime chunk(s) ` +
      `(${runtimeChunks.map((f) => f.split('/').pop()).join(', ')}) are absent from all ` +
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
