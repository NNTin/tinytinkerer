import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)
const SCRIPT_PATH = fileURLToPath(new URL('./check-boundaries.mjs', import.meta.url))

// Writes a small fixture monorepo into a fresh temp dir and returns its path.
// Values that are plain objects are JSON-stringified (package.json manifests);
// string values are written verbatim (source files).
const makeFixture = async (files) => {
  const dir = await mkdtemp(join(os.tmpdir(), 'boundaries-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(dir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    await writeFile(filePath, body)
  }
  return dir
}

// Runs the checker against a fixture dir and reports its result instead of
// throwing on the nonzero exit code that boundary violations produce.
const runChecker = async (dir) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT_PATH], { cwd: dir })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

const pkg = (name, extra) => ({ name, private: true, version: '0.0.0', ...extra })

const withFixture = async (t, files) => {
  const dir = await makeFixture(files)
  t.after(() => rm(dir, { recursive: true, force: true }))
  return runChecker(dir)
}

test('clean pass: local relative import plus an unrestricted consumer importing contracts', async (t) => {
  const result = await withFixture(t, {
    'packages/contracts/package.json': pkg('@tinytinkerer/contracts'),
    'packages/contracts/src/index.ts': "export { helper } from './helper'\n",
    'packages/contracts/src/helper.ts': 'export const helper = () => true\n',
    'packages/some-consumer/package.json': pkg('@tinytinkerer/some-consumer'),
    'packages/some-consumer/src/index.ts':
      "import { helper } from '@tinytinkerer/contracts'\n\nexport const useHelper = () => helper()\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('workspace package subpath imports are forbidden', async (t) => {
  const result = await withFixture(t, {
    'packages/contracts/package.json': pkg('@tinytinkerer/contracts'),
    'packages/consumer/package.json': pkg('@tinytinkerer/consumer'),
    'packages/consumer/src/index.ts': "import { x } from '@tinytinkerer/contracts/deep'\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /workspace package subpath imports are forbidden/)
})

test('the server-safe documentation corpus facade is allowed', async (t) => {
  const result = await withFixture(t, {
    'packages/app-browser/package.json': pkg('@tinytinkerer/app-browser'),
    'packages/app-browser/src/index.ts': '',
    'packages/consumer/package.json': pkg('@tinytinkerer/consumer'),
    'packages/consumer/src/index.ts':
      "import { version } from '@tinytinkerer/app-browser/documentation-corpus'\n"
  })

  assert.equal(result.code, 0)
})

test('app-to-app imports are forbidden', async (t) => {
  const result = await withFixture(t, {
    'apps/app-one/package.json': pkg('@tinytinkerer/app-one', {
      tinytinkerer: { architectureRole: 'host-compositor' }
    }),
    'apps/app-two/package.json': pkg('@tinytinkerer/app-two', {
      tinytinkerer: { architectureRole: 'host-compositor' }
    }),
    'apps/app-one/src/index.ts': "import { x } from '@tinytinkerer/app-two'\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /app-to-app imports are forbidden/)
})

test('forbidden dependency declared only in package.json is still caught', async (t) => {
  const result = await withFixture(t, {
    'apps/app-browser/package.json': pkg('@tinytinkerer/app-browser', {
      tinytinkerer: { architectureRole: 'browser-shell' }
    }),
    'packages/agent-core/package.json': pkg('@tinytinkerer/agent-core', {
      dependencies: { '@tinytinkerer/app-browser': 'workspace:*' }
    })
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /agent-core may import only contracts and agent-core-local modules/)
})

test('package cycle detected via package.json-declared dependencies', async (t) => {
  const result = await withFixture(t, {
    'packages/foo/package.json': pkg('@tinytinkerer/foo', {
      dependencies: { '@tinytinkerer/bar': 'workspace:*' }
    }),
    'packages/bar/package.json': pkg('@tinytinkerer/bar', {
      dependencies: { '@tinytinkerer/foo': 'workspace:*' }
    })
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /Package cycle detected:/)
})

test('apps must declare architecture metadata, and the role must be valid', async (t) => {
  const result = await withFixture(t, {
    'apps/shell-without-meta/package.json': pkg('@tinytinkerer/shell-without-meta'),
    'apps/shell-bad-role/package.json': pkg('@tinytinkerer/shell-bad-role', {
      tinytinkerer: { architectureRole: 'not-a-real-role' }
    })
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /apps must declare tinytinkerer architecture metadata/)
  assert.match(result.stderr, /invalid tinytinkerer\.architectureRole/)
})

test('integrated shells may import only their declared trusted stage package', async (t) => {
  const result = await withFixture(t, {
    'packages/ide/package.json': pkg('@tinytinkerer/ide'),
    'packages/other/package.json': pkg('@tinytinkerer/other'),
    'apps/ide/package.json': pkg('@tinytinkerer/ide-shell', {
      tinytinkerer: {
        architectureRole: 'integrated-shell',
        stagePackage: '@tinytinkerer/ide'
      }
    }),
    'apps/ide/src/good.ts': "import { stage } from '@tinytinkerer/ide'\n",
    'apps/ide/src/bad.ts': "import { other } from '@tinytinkerer/other'\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /integrated shells may depend only/)
  assert.ok(!result.stderr.includes('good.ts'), 'declared stage package must be allowed')
})

test('integrated shells require a workspace stage package', async (t) => {
  const result = await withFixture(t, {
    'apps/ide/package.json': pkg('@tinytinkerer/ide-shell', {
      tinytinkerer: { architectureRole: 'integrated-shell' }
    })
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /integrated-shell must declare a workspace stagePackage/)
})

test('PRODUCT_AGNOSTIC_SOURCE_RULES apply to plugin packages, with word-boundary negatives passing', async (t) => {
  const result = await withFixture(t, {
    'packages/plugins/plugin-demo/package.json': pkg('@tinytinkerer/plugin-demo'),
    'packages/plugins/plugin-demo/src/window-usage.ts':
      'export const href = window.location.href\n',
    'packages/plugins/plugin-demo/src/react-usage.tsx':
      "import { useState } from 'react'\n\nexport const Component = () => useState(0)\n",
    // Near-miss identifiers that must NOT trip the word-boundary/lookaround
    // patterns: `myWindow`/`windows` aren't the bare identifier `window`, and
    // `refetchQueries(` isn't a boundary-preceded `fetch(`.
    'packages/plugins/plugin-demo/src/negative-case.ts':
      'const myWindow = 1\nconst windows = 2\nrefetchQueries()\n'
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /must not use window/)
  assert.match(result.stderr, /must not use React import/)
  assert.ok(!result.stderr.includes('negative-case.ts'), 'negative-case.ts must not be flagged')
})

test('pure type-declaration module gate: interface-only file passes', async (t) => {
  const result = await withFixture(t, {
    'packages/shared/contracts/package.json': pkg('@tinytinkerer/contracts'),
    'packages/shared/contracts/src/plugin-views.ts': 'export interface Foo {\n  a: string\n}\n'
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('pure type-declaration module gate: a runtime value is rejected', async (t) => {
  const result = await withFixture(t, {
    'packages/shared/contracts/package.json': pkg('@tinytinkerer/contracts'),
    'packages/shared/contracts/src/plugin-views.ts': 'export const x = 1\n'
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /pure type-declaration module/)
})

test('sentry-telemetry is a leaf package', async (t) => {
  const result = await withFixture(t, {
    'packages/contracts/package.json': pkg('@tinytinkerer/contracts'),
    'packages/sentry-telemetry/package.json': pkg('@tinytinkerer/sentry-telemetry'),
    'packages/sentry-telemetry/src/index.ts': "import { x } from '@tinytinkerer/contracts'\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /sentry-telemetry is a leaf/)
})

test('dynamic import() is detected the same as a static import', async (t) => {
  const result = await withFixture(t, {
    'apps/app-alpha/package.json': pkg('@tinytinkerer/app-alpha', {
      tinytinkerer: { architectureRole: 'host-compositor' }
    }),
    'apps/app-beta/package.json': pkg('@tinytinkerer/app-beta', {
      tinytinkerer: { architectureRole: 'host-compositor' }
    }),
    'apps/app-alpha/src/loader.ts':
      "export const load = async () => import('@tinytinkerer/app-beta')\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /app-to-app imports are forbidden/)
})

test('edge-service apps may import only contracts, sentry-telemetry, and edge-local modules', async (t) => {
  const result = await withFixture(t, {
    'apps/edge-svc/package.json': pkg('@tinytinkerer/edge-svc', {
      tinytinkerer: { architectureRole: 'edge-service' }
    }),
    'packages/some-lib/package.json': pkg('@tinytinkerer/some-lib'),
    'apps/edge-svc/src/index.ts': "import { x } from '@tinytinkerer/some-lib'\n"
  })

  assert.equal(result.code, 1)
  assert.match(
    result.stderr,
    /edge may import only contracts, sentry-telemetry, and edge-local modules/
  )
})

test('app-shell may import only app-browser, contracts, and local modules', async (t) => {
  const result = await withFixture(t, {
    'packages/app-core/package.json': pkg('@tinytinkerer/app-core'),
    'packages/app-shell/package.json': pkg('@tinytinkerer/app-shell'),
    'packages/app-shell/src/index.ts': "import { x } from '@tinytinkerer/app-core'\n"
  })

  assert.equal(result.code, 1)
  assert.match(
    result.stderr,
    /app-shell may import only app-browser, contracts, and app-shell-local modules/
  )
})

test('app-shell importing contracts passes', async (t) => {
  const result = await withFixture(t, {
    'packages/contracts/package.json': pkg('@tinytinkerer/contracts'),
    'packages/app-shell/package.json': pkg('@tinytinkerer/app-shell'),
    'packages/app-shell/src/index.ts':
      "import type { ChatEvent } from '@tinytinkerer/contracts'\n\nexport type { ChatEvent }\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('app-shell importing app-browser passes', async (t) => {
  const result = await withFixture(t, {
    'packages/app-browser/package.json': pkg('@tinytinkerer/app-browser'),
    'packages/app-shell/package.json': pkg('@tinytinkerer/app-shell'),
    'packages/app-shell/src/index.ts':
      "import { ChatApp } from '@tinytinkerer/app-browser'\n\nexport const use = () => ChatApp\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('host compositors may not import a non-app-browser workspace package', async (t) => {
  const result = await withFixture(t, {
    'packages/contracts/package.json': pkg('@tinytinkerer/contracts'),
    'apps/host/package.json': pkg('@tinytinkerer/host', {
      tinytinkerer: { architectureRole: 'host-compositor' }
    }),
    'apps/host/src/main.ts': "import { schema } from '@tinytinkerer/contracts'\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /host compositors may depend only on/)
})

test('host compositor importing app-browser passes', async (t) => {
  const result = await withFixture(t, {
    'packages/app-browser/package.json': pkg('@tinytinkerer/app-browser'),
    'apps/host/package.json': pkg('@tinytinkerer/host', {
      tinytinkerer: { architectureRole: 'host-compositor' }
    }),
    'apps/host/src/main.ts':
      "import { ChatApp } from '@tinytinkerer/app-browser'\n\nexport const app = ChatApp\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('brand-assets is metadata-only: authored React code is rejected', async (t) => {
  const result = await withFixture(t, {
    'packages/brand-assets/package.json': pkg('@tinytinkerer/brand-assets'),
    'packages/brand-assets/src/react.tsx':
      "import { useState } from 'react'\n\nexport const Footer = () => useState(0)\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /@tinytinkerer\/brand-assets must not use React import/)
})

test('brand-assets exporting pure metadata passes', async (t) => {
  const result = await withFixture(t, {
    'packages/brand-assets/package.json': pkg('@tinytinkerer/brand-assets'),
    'packages/brand-assets/src/index.ts': "export const TINYTINKERER_BRAND = { name: 'x' }\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('generated data modules are exempt from source-constraint scanning', async (t) => {
  // A *.generated.ts file whose embedded upstream text happens to contain
  // trigger substrings must NOT trip the source rules — generated notice/license
  // data is not authored source the boundary governs.
  const result = await withFixture(t, {
    'packages/brand-assets/package.json': pkg('@tinytinkerer/brand-assets'),
    'packages/brand-assets/src/notices.generated.ts':
      "export const NOTICES = 'see window.location and fetch( for details'\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('the same trigger text in a hand-written module is still rejected', async (t) => {
  const result = await withFixture(t, {
    'packages/brand-assets/package.json': pkg('@tinytinkerer/brand-assets'),
    'packages/brand-assets/src/notices.ts':
      "export const href = window.location.href\n\nexport const load = () => fetch('/x')\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /@tinytinkerer\/brand-assets must not use/)
})

// --- The plugin catalogue (issue #495) -------------------------------------
//
// The catalogue is the one package allowed to name a concrete plugin package.
// Three cases, because the interesting property is not that the permission
// exists but that it is BOUNDED — validateBoundary has no default-deny, so a
// package nobody wrote a rule for is unconstrained entirely, and "the catalogue
// may import plugins" must not have quietly meant "the catalogue may import
// anything".

test('the plugin catalogue may import a concrete plugin package', async (t) => {
  const result = await withFixture(t, {
    'packages/plugins/plugin-demo/package.json': pkg('@tinytinkerer/plugin-demo'),
    'packages/plugins/plugin-demo/src/index.ts': 'export const manifest = { id: "demo" }\n',
    'packages/app/catalogue/package.json': pkg('@tinytinkerer/catalogue'),
    'packages/app/catalogue/src/index.ts':
      "export const load = () => import('@tinytinkerer/plugin-demo')\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})

test('the plugin catalogue may NOT import beyond plugins and contracts', async (t) => {
  const result = await withFixture(t, {
    'packages/app-browser/package.json': pkg('@tinytinkerer/app-browser'),
    'packages/app/catalogue/package.json': pkg('@tinytinkerer/catalogue'),
    'packages/app/catalogue/src/index.ts':
      "import { createBrowserApp } from '@tinytinkerer/app-browser'\n\nexport const x = createBrowserApp\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /the plugin catalogue may import only concrete plugin packages/)
})

test('app-browser still may not import a concrete plugin package', async (t) => {
  const result = await withFixture(t, {
    'packages/plugins/plugin-demo/package.json': pkg('@tinytinkerer/plugin-demo'),
    'packages/plugins/plugin-demo/src/index.ts': 'export const manifest = { id: "demo" }\n',
    'packages/app-browser/package.json': pkg('@tinytinkerer/app-browser'),
    'packages/app-browser/src/index.ts':
      "export const load = () => import('@tinytinkerer/plugin-demo')\n"
  })

  assert.equal(result.code, 1)
  assert.match(result.stderr, /app-browser may import only/)
})

test('an integrated shell may depend on the plugin catalogue', async (t) => {
  const result = await withFixture(t, {
    'packages/app/catalogue/package.json': pkg('@tinytinkerer/catalogue'),
    'packages/stage/package.json': pkg('@tinytinkerer/stage'),
    'apps/docs/package.json': pkg('@tinytinkerer/docs', {
      tinytinkerer: { architectureRole: 'integrated-shell', stagePackage: '@tinytinkerer/stage' }
    }),
    'apps/docs/src/main.ts': "export const load = () => import('@tinytinkerer/catalogue')\n"
  })

  assert.equal(result.code, 0)
  assert.equal(result.stdout.trim(), 'Boundary checks passed.')
})
