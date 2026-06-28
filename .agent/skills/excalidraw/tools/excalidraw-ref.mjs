#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PACKAGE = '@excalidraw/excalidraw'
const PINNED_NPM_VERSION = '0.18.1'
const REF = join(homedir(), 'excalidraw')
const KEY_DOCS = [
  'dev-docs/docs/@excalidraw/excalidraw/api/props/props.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/api/props/excalidraw-api.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton.mdx',
  'dev-docs/docs/@excalidraw/excalidraw/installation.mdx'
]

console.log(`reference clone : ${REF}`)
console.log(`npm package     : ${PACKAGE}@${PINNED_NPM_VERSION} (packages/app/excalidraw-app)`)

if (!existsSync(REF)) {
  console.error(
    `\nclone not found. Create the READ-ONLY reference:\n  git clone https://github.com/excalidraw/excalidraw ${REF}`
  )
  process.exit(1)
}

const query = process.argv[2]
if (!query) {
  console.log('\nkey docs:')
  for (const doc of KEY_DOCS) console.log(`  ${existsSync(join(REF, doc)) ? '✓' : '✗'} ${doc}`)
  process.exit(0)
}

console.log(`\nmatches for "${query}":\n`)
try {
  process.stdout.write(
    execFileSync('git', ['-C', REF, 'grep', '-n', '-I', '--heading', '--break', query], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
  )
} catch (error) {
  if (error.status === 1) {
    console.log('(no matches)')
    process.exit(0)
  }
  throw error
}
