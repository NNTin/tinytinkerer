import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { TextDecoder } from 'node:util'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8'
}).trim()
const decoder = new TextDecoder('utf-8', { fatal: true })

// These are intentionally versioned binary assets. Every other tracked file is
// expected to be UTF-8 text and must not contain literal NUL bytes.
const binaryExtensions = new Set([
  '.avif',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.webp',
  '.woff',
  '.woff2',
  '.zip'
])

const trackedFiles = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)

const failures = []
let checked = 0
let skipped = 0

for (const file of trackedFiles) {
  const path = join(root, file)
  if (!existsSync(path)) continue

  if (binaryExtensions.has(extname(file).toLowerCase())) {
    skipped += 1
    continue
  }

  checked += 1
  const buffer = readFileSync(path)
  if (buffer.includes(0)) {
    failures.push(`${file}: contains a NUL byte; use escaped sequences instead`)
    continue
  }

  try {
    decoder.decode(buffer)
  } catch {
    failures.push(`${file}: is not valid UTF-8 text`)
  }
}

if (failures.length > 0) {
  console.error('Tracked text file check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(`Tracked text file check passed (${checked} checked, ${skipped} binary skipped).`)
