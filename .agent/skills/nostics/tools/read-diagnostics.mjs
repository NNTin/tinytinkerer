#!/usr/bin/env node
// Pretty-print the diagnostics the dev-server collector wrote to `.nostics.log`.
//
// The collector (`@nostics/unplugin/dev-server-collector`, wired into
// apps/web/vite.config.ts for `vite serve`) appends each browser diagnostic as
// one NDJSON line via nostics' file reporter. The serialized shape is the
// Diagnostic's `toJSON()`: { name, why, fix, docs, sources, cause, stack }.
//
// Usage:
//   node .agent/skills/nostics/tools/read-diagnostics.mjs            # print all
//   node .agent/skills/nostics/tools/read-diagnostics.mjs --code TT_X  # filter
//   node .agent/skills/nostics/tools/read-diagnostics.mjs --file path  # explicit log
//   node .agent/skills/nostics/tools/read-diagnostics.mjs --watch     # tail
//
// Run this instead of `cat`-ing the raw log — the file is one JSON object per
// line and hard to read by hand.

import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

// Default search order: each browser shell's dev server (web/mobile/widget) runs
// from its own dir, so the collector writes <shell>/.nostics.log; fall back to a
// repo-root log just in case. The first existing one wins.
const DEFAULT_LOGS = [
  resolve(repoRoot, 'apps/web/.nostics.log'),
  resolve(repoRoot, 'apps/mobile/.nostics.log'),
  resolve(repoRoot, 'apps/widget/.nostics.log'),
  resolve(repoRoot, '.nostics.log')
]

const parseArgs = (argv) => {
  const args = { watch: false, code: undefined, file: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--watch' || arg === '-w') args.watch = true
    else if (arg === '--code' || arg === '-c') args.code = argv[++i]
    else if (arg === '--file' || arg === '-f') args.file = argv[++i]
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (!args.file) args.file = arg
  }
  return args
}

const resolveLogFile = (explicit) => {
  if (explicit) return resolve(process.cwd(), explicit)
  return DEFAULT_LOGS.find((candidate) => existsSync(candidate))
}

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'
const color = process.stdout.isTTY

const paint = (code, text) => (color ? `${code}${text}${RESET}` : text)

const formatEntry = (entry) => {
  const lines = []
  lines.push(`${paint(BOLD, paint(CYAN, `[${entry.name ?? 'DIAGNOSTIC'}]`))} ${entry.why ?? ''}`)
  if (entry.fix) lines.push(`  ${paint(YELLOW, 'fix')} ${entry.fix}`)
  if (Array.isArray(entry.sources) && entry.sources.length > 0) {
    lines.push(`  ${paint(DIM, 'sources')} ${entry.sources.join(', ')}`)
  }
  if (entry.docs) lines.push(`  ${paint(DIM, 'docs')} ${entry.docs}`)
  if (entry.cause !== undefined && entry.cause !== null) {
    const cause = typeof entry.cause === 'string' ? entry.cause : JSON.stringify(entry.cause)
    lines.push(`  ${paint(DIM, 'cause')} ${cause}`)
  }
  return lines.join('\n')
}

const printLine = (rawLine, filter) => {
  const trimmed = rawLine.trim()
  if (!trimmed) return false
  let entry
  try {
    entry = JSON.parse(trimmed)
  } catch {
    return false
  }
  if (filter && entry.name !== filter) return false
  process.stdout.write(`${formatEntry(entry)}\n\n`)
  return true
}

const readAll = async (logFile, filter) => {
  let count = 0
  const rl = createInterface({ input: createReadStream(logFile), crlfDelay: Infinity })
  for await (const line of rl) {
    if (printLine(line, filter)) count++
  }
  return count
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write('Usage: read-diagnostics.mjs [--watch] [--code <CODE>] [--file <path>]\n')
    return
  }

  const logFile = resolveLogFile(args.file)
  if (!logFile || !existsSync(logFile)) {
    process.stderr.write(
      `No .nostics.log found (looked at: ${args.file ? args.file : DEFAULT_LOGS.join(', ')}).\n` +
        'Start the dev server (vite serve) and reproduce a diagnostic first — see ' +
        'workflows/read-dev-diagnostics.md.\n'
    )
    process.exitCode = 1
    return
  }

  const count = await readAll(logFile, args.code)
  if (count === 0) {
    process.stdout.write(`(no${args.code ? ` ${args.code}` : ''} diagnostics in ${logFile} yet)\n`)
  }

  if (!args.watch) return

  process.stdout.write(`${paint(DIM, `… watching ${logFile} (Ctrl-C to stop)`)}\n`)
  let offset = statSync(logFile).size
  watch(logFile, { persistent: true }, () => {
    let size
    try {
      size = statSync(logFile).size
    } catch {
      return
    }
    if (size <= offset) {
      offset = size // truncated/rotated
      return
    }
    const stream = createReadStream(logFile, { start: offset, end: size })
    offset = size
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    rl.on('line', (line) => printLine(line, args.code))
  })
}

main().catch((error) => {
  process.stderr.write(`read-diagnostics failed: ${error?.message ?? error}\n`)
  process.exitCode = 1
})
