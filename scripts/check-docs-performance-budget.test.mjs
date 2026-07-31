import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)
const SCRIPT_PATH = fileURLToPath(new URL('./check-docs-performance-budget.mjs', import.meta.url))
const MARKER = 'Failed to start the live lab session.'
const ASSISTANT_MARKER = 'Failed to start the documentation assistant session.'

// Every fixture below needs BOTH runtime doors present, since the checker fails
// loudly when a marker is missing entirely (a stale build looks the same as a
// well-behaved one otherwise). This is the assistant's, kept out of every page's
// HTML unless a test puts it there on purpose.
const ASSISTANT_CHUNK = {
  'apps/docs/build/assets/js/8811.ghi789.js': `console.log(${JSON.stringify(ASSISTANT_MARKER)})`
}

// Writes a small fixture "apps/docs/build" tree into a fresh temp dir (used as
// the checker's cwd) and returns its path.
const makeFixture = async (files) => {
  const dir = await mkdtemp(join(os.tmpdir(), 'docs-perf-budget-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content)
  }
  return dir
}

const runChecker = async (dir) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT_PATH], { cwd: dir })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

const withFixture = async (t, files) => {
  const dir = await makeFixture(files)
  t.after(() => rm(dir, { recursive: true, force: true }))
  return runChecker(dir)
}

test('passes when the runtime chunk is absent from every built page', async (t) => {
  const result = await withFixture(t, {
    'apps/docs/build/index.html':
      '<html><body><script src="/assets/js/main.abc123.js"></script></body></html>',
    'apps/docs/build/assets/js/main.abc123.js': 'console.log("light page bootstrap")',
    'apps/docs/build/assets/js/7574.def456.js': `console.log(${JSON.stringify(MARKER)})`,
    ...ASSISTANT_CHUNK
  })

  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Performance budget OK/)
})

test('fails when a page eagerly references the runtime chunk', async (t) => {
  const result = await withFixture(t, {
    'apps/docs/build/index.html':
      '<html><body><script src="/assets/js/main.abc123.js"></script><link rel="preload" as="script" href="/assets/js/7574.def456.js"></body></html>',
    'apps/docs/build/assets/js/main.abc123.js': 'console.log("light page bootstrap")',
    'apps/docs/build/assets/js/7574.def456.js': `console.log(${JSON.stringify(MARKER)})`,
    ...ASSISTANT_CHUNK
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Performance budget violated/)
  assert.match(result.stderr, /7574\.def456\.js/)
})

test('fails loudly when the marker is not found in any built chunk', async (t) => {
  const result = await withFixture(t, {
    'apps/docs/build/index.html':
      '<html><body><script src="/assets/js/main.abc123.js"></script></body></html>',
    'apps/docs/build/assets/js/main.abc123.js': 'console.log("no live-lab code in this build")',
    ...ASSISTANT_CHUNK
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Could not find the live-lab client-runtime chunk/)
})

// The assistant's host is mounted from @theme/Root, so this is the violation the
// check most needs to catch: every page would carry the runtime, not just one.
test('fails when a page eagerly references the assistant runtime chunk', async (t) => {
  const result = await withFixture(t, {
    'apps/docs/build/index.html':
      '<html><body><script src="/assets/js/main.abc123.js"></script><script src="/assets/js/8811.ghi789.js"></script></body></html>',
    'apps/docs/build/assets/js/main.abc123.js': 'console.log("light page bootstrap")',
    'apps/docs/build/assets/js/7574.def456.js': `console.log(${JSON.stringify(MARKER)})`,
    ...ASSISTANT_CHUNK
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Performance budget violated/)
  assert.match(result.stderr, /documentation assistant runtime/)
})

test('fails loudly when the assistant marker is not found in any built chunk', async (t) => {
  const result = await withFixture(t, {
    'apps/docs/build/index.html':
      '<html><body><script src="/assets/js/main.abc123.js"></script></body></html>',
    'apps/docs/build/assets/js/main.abc123.js': 'console.log("light page bootstrap")',
    'apps/docs/build/assets/js/7574.def456.js': `console.log(${JSON.stringify(MARKER)})`
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Could not find the documentation assistant runtime chunk/)
})

test('fails loudly when apps/docs/build does not exist', async (t) => {
  const result = await withFixture(t, {})

  assert.equal(result.code, 1)
  assert.match(result.stderr, /does not exist/)
})
