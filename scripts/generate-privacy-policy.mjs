import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(rootDir, 'docs', 'PRIVACY.md')
const updateSourcePath = join(rootDir, 'docs', 'PRIVACY-UPDATE.md')
const modulePath = join(
  rootDir,
  'packages',
  'app',
  'app-browser',
  'src',
  'telemetry',
  'privacy-policy.generated.ts'
)

const main = async () => {
  const [text, updateNotice] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(updateSourcePath, 'utf8')
  ])
  const version = createHash('sha256').update(text).digest('hex').slice(0, 12)
  const module = `// AUTO-GENERATED from docs/PRIVACY.md and docs/PRIVACY-UPDATE.md by scripts/generate-privacy-policy.mjs — do not edit.\nexport const PRIVACY_POLICY_VERSION = ${JSON.stringify(version)}\nexport const PRIVACY_POLICY = ${JSON.stringify(text)}\nexport const PRIVACY_POLICY_UPDATE_NOTICE = ${JSON.stringify(updateNotice)}\n`
  await writeFile(modulePath, module)
  console.log(`Generated privacy policy module at ${modulePath}`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
