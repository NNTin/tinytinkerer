/**
 * Writes the exact directory that gets published (issue #510, T1):
 *
 *   node scripts/stage-package.mjs <out-dir> [--version <semver>]
 *
 * The workspace manifest carries `devDependencies` on private `workspace:*`
 * packages (they are bundled into dist/, never installed) and build scripts
 * that only make sense inside this repository. Neither belongs in the
 * published manifest, so the staged copy keeps only what a host reads. Both
 * the release workflow and the acceptance run (acceptance/run.mjs) publish or
 * pack from this staged directory, so what is tested is what is shipped.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const args = process.argv.slice(2)
const outArg = args[0]
if (!outArg || outArg.startsWith('--')) {
  console.error('usage: node scripts/stage-package.mjs <out-dir> [--version <semver>]')
  process.exit(2)
}
const versionIndex = args.indexOf('--version')
const version = versionIndex === -1 ? undefined : args[versionIndex + 1]
if (versionIndex !== -1 && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error(`--version must be a semver version, got ${version}`)
  process.exit(2)
}

if (
  !existsSync(join(packageDir, 'dist/index.js')) ||
  !existsSync(join(packageDir, 'dist/index.d.ts'))
) {
  console.error(
    'dist/ is missing or incomplete; run `pnpm --filter @nntin/tinytinkerer-embed build` first'
  )
  process.exit(1)
}

const outDir = resolve(outArg)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const { devDependencies: _dev, scripts: _scripts, ...published } = manifest
if (version) {
  published.version = version
}
writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(published, null, 2)}\n`)

// The licence text is the REPOSITORY's, copied from the root at staging time
// rather than kept as a build output. A build output it cannot be: turbo
// caches `build` as `dist/**` only, so a cache hit restores dist/ and nothing
// beside it — which is how a cached CI build once staged a package with no
// LICENSE and failed. Staging owns it, so every path that stages (the
// acceptance run, the release workflow) gets it from the one source.
const repoLicense = resolve(packageDir, '../../../LICENSE')
for (const entry of manifest.files) {
  const source = entry === 'LICENSE' ? repoLicense : join(packageDir, entry)
  cpSync(source, join(outDir, entry), { recursive: true })
}

console.log(`[embed] staged ${published.name}@${published.version} in ${outDir}`)
