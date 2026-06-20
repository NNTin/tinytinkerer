import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_BUCKET,
  bucketForDir,
  derivePackageName,
  isAlreadyRegrouped,
  regroupLabels
} from './regroup-allure-suites.mjs'

// ── bucketForDir: path-driven mapping incl. the within-dir splits ───────────

test('apps map to frontend except apps/edge (backend)', () => {
  assert.equal(bucketForDir('apps/web'), 'frontend')
  assert.equal(bucketForDir('apps/widget'), 'frontend')
  assert.equal(bucketForDir('apps/mobile'), 'frontend')
  assert.equal(bucketForDir('apps/host'), 'frontend')
  assert.equal(bucketForDir('apps/edge'), 'backend')
})

test('packages/app/* split: app-browser→frontend, agent-core/app-core→core', () => {
  assert.equal(bucketForDir('packages/app/app-browser'), 'frontend')
  assert.equal(bucketForDir('packages/app/agent-core'), 'core')
  assert.equal(bucketForDir('packages/app/app-core'), 'core')
})

test('packages/shared/* split: ui→frontend, contracts/sentry-telemetry→shared', () => {
  assert.equal(bucketForDir('packages/shared/ui'), 'frontend')
  assert.equal(bucketForDir('packages/shared/contracts'), 'shared')
  assert.equal(bucketForDir('packages/shared/sentry-telemetry'), 'shared')
})

test('plugins, content, brand and e2e map by directory prefix', () => {
  assert.equal(bucketForDir('packages/plugins/plugin-web-search'), 'plugins')
  assert.equal(bucketForDir('packages/plugins/plugin-feedback'), 'plugins')
  assert.equal(bucketForDir('packages/content/content-core'), 'frontend')
  assert.equal(bucketForDir('packages/content/renderers/content-mermaid'), 'frontend')
  assert.equal(bucketForDir('packages/brand/brand-assets'), 'frontend')
  assert.equal(bucketForDir('packages/e2e'), 'e2e')
})

test('new packages under a known prefix bucket automatically', () => {
  assert.equal(bucketForDir('apps/new-shell'), 'frontend')
  assert.equal(bucketForDir('packages/plugins/plugin-brand-new'), 'plugins')
  assert.equal(bucketForDir('packages/content/content-future'), 'frontend')
})

test('unmapped dirs fall back to DEFAULT_BUCKET and fire onUnmapped once', () => {
  const seen = []
  // A new packages/app/* that is neither app-browser nor a *-core split.
  assert.equal(
    bucketForDir('packages/app/mystery', (dir) => seen.push(dir)),
    DEFAULT_BUCKET
  )
  // A brand-new top-level tree the rules don't know about.
  assert.equal(bucketForDir('packages/experimental/thing'), DEFAULT_BUCKET)
  assert.equal(bucketForDir('tools/whatever'), DEFAULT_BUCKET)
  assert.deepEqual(seen, ['packages/app/mystery'])
})

test('windows-style separators normalise to posix before matching', () => {
  assert.equal(bucketForDir('packages\\shared\\contracts'), 'shared')
  assert.equal(bucketForDir('apps\\edge'), 'backend')
})

// ── derivePackageName: vitest (fullName) and playwright (package label) ──────

const known = new Set([
  '@tinytinkerer/contracts',
  '@tinytinkerer/web',
  '@tinytinkerer/e2e',
  '@tinytinkerer/content-core'
])

test('vitest: package taken from the fullName "<pkg>:path#…" prefix', () => {
  const result = {
    fullName: '@tinytinkerer/contracts:tests/edge-openapi.test.ts#edge openapi spec exposes…',
    labels: [{ name: 'package', value: '@tinytinkerer/contracts.tests.edge-openapi.test.ts' }]
  }
  assert.equal(derivePackageName(result, known), '@tinytinkerer/contracts')
})

test('playwright: fullName has no package prefix, so the package label is used', () => {
  const result = {
    fullName: 'tests/sandbox-isolation.e2e.ts:42:5',
    labels: [
      { name: 'parentSuite', value: 'chromium' },
      { name: 'package', value: '@tinytinkerer/e2e.tests.sandbox-isolation.e2e.ts' }
    ]
  }
  assert.equal(derivePackageName(result, known), '@tinytinkerer/e2e')
})

test('returns null when no known package matches', () => {
  const result = {
    fullName: 'tests/foo.ts:1:1',
    labels: [{ name: 'package', value: '@tinytinkerer/unknown.tests.foo.ts' }]
  }
  assert.equal(derivePackageName(result, known), null)
})

// ── regroupLabels: rewrite the suite trio, preserve everything else ─────────

test('vitest result: parentSuite→bucket, suite→package, subSuite→original describe', () => {
  const labels = [
    { name: 'framework', value: 'vitest' },
    { name: 'parentSuite', value: 'edge openapi spec' },
    { name: 'package', value: '@tinytinkerer/contracts.tests.edge-openapi.test.ts' }
  ]
  const out = regroupLabels(labels, { bucket: 'shared', packageName: '@tinytinkerer/contracts' })
  const byName = Object.fromEntries(out.map((l) => [l.name, l.value]))
  assert.equal(byName.parentSuite, 'shared')
  assert.equal(byName.suite, '@tinytinkerer/contracts')
  assert.equal(byName.subSuite, 'edge openapi spec')
  // Non-suite labels are preserved untouched.
  assert.equal(byName.framework, 'vitest')
  assert.equal(byName.package, '@tinytinkerer/contracts.tests.edge-openapi.test.ts')
})

test('e2e result: browser (original parentSuite) becomes the subSuite, shard tag kept', () => {
  const labels = [
    { name: 'parentSuite', value: 'chromium' },
    { name: 'tag', value: 'chromium' },
    { name: 'tag', value: 'shard-2' },
    { name: 'package', value: '@tinytinkerer/e2e.tests.sandbox-isolation.e2e.ts' }
  ]
  const out = regroupLabels(labels, { bucket: 'e2e', packageName: '@tinytinkerer/e2e' })
  const byName = Object.fromEntries(out.map((l) => [l.name, l.value]))
  assert.equal(byName.parentSuite, 'e2e')
  assert.equal(byName.suite, '@tinytinkerer/e2e')
  assert.equal(byName.subSuite, 'chromium')
  // The browser/shard tags from #258 survive the rewrite.
  const tags = out.filter((l) => l.name === 'tag').map((l) => l.value)
  assert.deepEqual(tags.sort(), ['chromium', 'shard-2'])
})

test('drops any pre-existing suite/subSuite from nested describes', () => {
  const labels = [
    { name: 'parentSuite', value: 'Top' },
    { name: 'suite', value: 'Middle' },
    { name: 'subSuite', value: 'Inner' },
    { name: 'package', value: '@tinytinkerer/web.src.foo.test.ts' }
  ]
  const out = regroupLabels(labels, { bucket: 'frontend', packageName: '@tinytinkerer/web' })
  const suites = out.filter((l) => l.name === 'suite').map((l) => l.value)
  const subSuites = out.filter((l) => l.name === 'subSuite').map((l) => l.value)
  assert.deepEqual(suites, ['@tinytinkerer/web'])
  assert.deepEqual(subSuites, ['Top'])
})

test('test with no describe gets no subSuite (sits directly under the package)', () => {
  const labels = [{ name: 'package', value: '@tinytinkerer/web.src.foo.test.ts' }]
  const out = regroupLabels(labels, { bucket: 'frontend', packageName: '@tinytinkerer/web' })
  assert.equal(
    out.find((l) => l.name === 'subSuite'),
    undefined
  )
  assert.equal(out.find((l) => l.name === 'parentSuite').value, 'frontend')
  assert.equal(out.find((l) => l.name === 'suite').value, '@tinytinkerer/web')
})

// ── isAlreadyRegrouped: idempotency guard ───────────────────────────────────

test('isAlreadyRegrouped flags regrouped output so the dir pass can skip it', () => {
  // Already regrouped: parentSuite is a bucket AND suite is the package name. The
  // regroupDir pass uses this to skip the result, keeping a re-run a no-op (without
  // the guard, a second regroupLabels would overwrite subSuite with the bucket name).
  const regrouped = regroupLabels(
    [
      { name: 'parentSuite', value: 'chromium' },
      { name: 'package', value: '@tinytinkerer/e2e.tests.spec.ts' }
    ],
    { bucket: 'e2e', packageName: '@tinytinkerer/e2e' }
  )
  assert.equal(regrouped.find((l) => l.name === 'subSuite').value, 'chromium')
  assert.equal(isAlreadyRegrouped(regrouped, '@tinytinkerer/e2e'), true)
})

test('isAlreadyRegrouped ignores original results even with a bucket-named describe', () => {
  // Original vitest result: parentSuite is a describe name, suite a nested describe —
  // suite never equals the package name, so a describe coincidentally named like a
  // bucket is still regrouped on the first pass.
  const original = [
    { name: 'parentSuite', value: 'frontend' },
    { name: 'suite', value: 'some nested describe' },
    { name: 'package', value: '@tinytinkerer/web.src.foo.test.ts' }
  ]
  assert.equal(isAlreadyRegrouped(original, '@tinytinkerer/web'), false)
})
