import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { TextDecoder } from 'node:util'

const root = process.cwd()
const scanRoot = join(root, 'packages/e2e')
const textExtensions = new Set(['.json', '.md', '.ts', '.tsx', '.yaml', '.yml'])
const ignoredDirectories = new Set(['node_modules', 'playwright-report', 'test-results'])
const decoder = new TextDecoder('utf-8', { fatal: true })

const extensionOf = (path) => {
  const index = path.lastIndexOf('.')
  return index === -1 ? '' : path.slice(index)
}

const collectTextFiles = (directory) => {
  const files = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      if (ignoredDirectories.has(entry)) continue
      files.push(...collectTextFiles(path))
      continue
    }
    if (stats.isFile() && textExtensions.has(extensionOf(path))) {
      files.push(path)
    }
  }
  return files
}

const failures = []

for (const file of collectTextFiles(scanRoot)) {
  const buffer = readFileSync(file)
  const displayPath = relative(root, file)

  if (buffer.includes(0)) {
    failures.push(`${displayPath}: contains a NUL byte; use escaped sequences instead`)
    continue
  }

  try {
    decoder.decode(buffer)
  } catch {
    failures.push(`${displayPath}: is not valid UTF-8 text`)
  }
}

if (failures.length > 0) {
  console.error('E2E text fixture check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('E2E text fixture check passed.')
