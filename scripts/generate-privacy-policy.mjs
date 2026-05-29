import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(rootDir, 'docs', 'PRIVACY.md')
const modulePath = join(
  rootDir,
  'packages',
  'app-browser',
  'src',
  'telemetry',
  'privacy-policy.generated.ts'
)

const main = async () => {
  const text = await readFile(sourcePath, 'utf8')
  const module = `// AUTO-GENERATED from docs/PRIVACY.md by scripts/generate-privacy-policy.mjs — do not edit.\nexport const PRIVACY_POLICY = ${JSON.stringify(text)}\n`
  await writeFile(modulePath, module)
  console.log(`Generated privacy policy module at ${modulePath}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
