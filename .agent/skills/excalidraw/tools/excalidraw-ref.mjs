#!/usr/bin/env node
// Locate and search the READ-ONLY Excalidraw reference clone.
//
// Excalidraw's real prop/API contracts live in its own repo, not in this one.
// A future agent should read the source/docs there instead of guessing — but
// the clone is large, so this tool prints its location + the high-value doc
// paths and greps it for you. The clone lives OUTSIDE tinytinkerer; NEVER
// modify it and NEVER commit it here.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Recorded for the FUTURE human-approved dependency add (the repo has a 7-day
// dependency age gate; do NOT add the dep as part of a skill-only change).
const PACKAGE = '@excalidraw/excalidraw'
const RECORDED_NPM_VERSION = '0.18.1' // `npm view @excalidraw/excalidraw version` at authoring time

const REF = join(homedir(), 'excalidraw')

// The docs an agent actually needs, relative to the clone root.
const KEY_DOCS = [
  'dev-docs/docs/@excalidraw/excalidraw/api/props/props.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/api/props/excalidraw-api.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/api/props/initialdata.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/api/utils/export.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/installation.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/integration.mdx'
]

const SETUP = `git clone https://github.com/excalidraw/excalidraw ${REF}`

const printHeader = () => {
  console.log(`reference clone : ${REF}`)
  console.log(`npm package     : ${PACKAGE}@${RECORDED_NPM_VERSION} (recorded; not yet a dep)`)
}

if (!existsSync(REF)) {
  printHeader()
  console.error(`\nclone not found. Create the READ-ONLY reference (do NOT commit it):\n  ${SETUP}`)
  process.exit(1)
}

const query = process.argv[2]

if (!query) {
  printHeader()
  console.log('\nkey docs (read these first):')
  for (const doc of KEY_DOCS) {
    console.log(`  ${existsSync(join(REF, doc)) ? '✓' : '✗'} ${doc}`)
  }
  console.log('\nsearch the reference:  node excalidraw-ref.mjs <query>')
  process.exit(0)
}

printHeader()
console.log(`\nmatches for "${query}" in ${REF}:\n`)
try {
  // `git grep` stays inside the tracked reference and is fast; -I skips binaries.
  const out = execFileSync('git', ['-C', REF, 'grep', '-n', '-I', '--heading', '--break', query], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  process.stdout.write(out)
} catch (error) {
  // git grep exits 1 when there are no matches — report that plainly.
  if (error.status === 1) {
    console.log('(no matches)')
    process.exit(0)
  }
  throw error
}
