import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

// Since issue #481 the checker also weighs three load profiles, and it fails
// loudly when the assets they describe are missing — a build with no corpus
// manifest, no document artifacts, or no search index is broken in a way that
// leaves unit tests green and the deployed assistant unable to read or search.
// So every fixture carries a minimal, well-under-budget set of them.
const BUDGETED_ASSETS = {
  'apps/docs/build/assets/docs-corpus/manifest.v1.abc.json': '{"schemaVersion":1,"documents":[]}',
  'apps/docs/build/assets/docs-corpus/documents/current-overview.abc.def.json': '{"markdown":""}',
  'apps/docs/build/search-index.json': '[]'
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
    ...ASSISTANT_CHUNK,
    ...BUDGETED_ASSETS
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
    ...ASSISTANT_CHUNK,
    ...BUDGETED_ASSETS
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
    ...ASSISTANT_CHUNK,
    ...BUDGETED_ASSETS
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
    ...ASSISTANT_CHUNK,
    ...BUDGETED_ASSETS
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

// === Byte budgets for the load profiles (issue #481) =========================

const HEALTHY_BUILD = {
  'apps/docs/build/index.html':
    '<html><body><script src="/docs/assets/js/main.abc123.js"></script></body></html>',
  'apps/docs/build/assets/js/main.abc123.js': 'console.log("light page bootstrap")',
  'apps/docs/build/assets/js/7574.def456.js': `console.log(${JSON.stringify(MARKER)})`,
  ...ASSISTANT_CHUNK,
  ...BUDGETED_ASSETS
}

test('reports each measured profile against its budget', async (t) => {
  const result = await withFixture(t, HEALTHY_BUILD)

  assert.equal(result.code, 0, result.stderr)
  // Printing the measurement, not just a verdict: a budget nobody can see the
  // headroom on is one that gets raised blindly the first time it trips.
  assert.match(result.stdout, /coldPage: [\d,]+ bytes \/ [\d,]+ bytes/)
  assert.match(result.stdout, /documentRead: [\d,]+ bytes/)
  assert.match(result.stdout, /search: [\d,]+ bytes/)
})

test('fails when a page references an asset the build does not contain', async (t) => {
  // A broken asset path would otherwise SHRINK the measured total, so the budget
  // would pass most convincingly at the moment the site stopped working.
  const result = await withFixture(t, {
    ...HEALTHY_BUILD,
    'apps/docs/build/index.html':
      '<html><body><script src="/docs/assets/js/main.abc123.js"></script>' +
      '<script src="/docs/assets/js/vanished.js"></script></body></html>'
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /references assets that are not in the build/)
  assert.match(result.stderr, /vanished\.js/)
})

test('fails when the corpus manifest is missing', async (t) => {
  const { 'apps/docs/build/assets/docs-corpus/manifest.v1.abc.json': _, ...withoutManifest } =
    HEALTHY_BUILD
  const result = await withFixture(t, withoutManifest)

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Expected exactly one corpus manifest/)
})

test('fails when the build emits no document artifacts', async (t) => {
  const {
    'apps/docs/build/assets/docs-corpus/documents/current-overview.abc.def.json': _,
    ...withoutArtifacts
  } = HEALTHY_BUILD
  const result = await withFixture(t, withoutArtifacts)

  assert.equal(result.code, 1)
  assert.match(result.stderr, /No per-document corpus artifacts/)
})

// The production-build smoke check. The upstream plugin writes this file only
// from its `postBuild` hook, so a build that stops emitting it leaves the
// deployed assistant reporting search as permanently unavailable while every
// unit test stays green — exactly the gap #481 asked for a check against.
test('fails when the production search index is missing', async (t) => {
  const { 'apps/docs/build/search-index.json': _, ...withoutIndex } = HEALTHY_BUILD
  const result = await withFixture(t, withoutIndex)

  assert.equal(result.code, 1)
  assert.match(result.stderr, /No search-index\.json/)
  assert.match(result.stderr, /search_docs reports the index as/)
})

test('fails when a profile exceeds its checked-in budget', async (t) => {
  const budget = JSON.parse(
    await readFile(
      fileURLToPath(new URL('../config/docs-performance-budget.json', import.meta.url))
    )
  )
  const result = await withFixture(t, {
    ...HEALTHY_BUILD,
    // One artifact past the document-read budget. Byte-for-byte over, so this
    // asserts the comparison rather than a wildly oversized fixture.
    'apps/docs/build/assets/docs-corpus/documents/current-huge.abc.def.json': 'x'.repeat(
      budget.profiles.documentRead.maxBytes + 1
    )
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Performance budget violated/)
  assert.match(result.stderr, /First document read/)
  // The failure points at the table, because raising a baseline is meant to be a
  // reviewable decision rather than a quick edit to a number in a script.
  assert.match(result.stderr, /config\/docs-performance-budget\.json/)
})
