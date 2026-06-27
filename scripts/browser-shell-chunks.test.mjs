import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserShellManualChunks } from './browser-shell-chunks.mjs'
import { createBrowserShellViteConfig } from './browser-shell-vite.mjs'

const restoreEnvironmentVariable = (name, value) => {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

const cases = [
  ['/repo/node_modules/react/index.js', 'react-vendor'],
  ['/repo/node_modules/react-router/dist/index.js', 'react-vendor'],
  ['/repo/node_modules/zod/index.js', 'zod-vendor'],
  ['/repo/packages/app/app-core/src/index.ts', 'app-core'],
  ['/repo/node_modules/@sentry/react/index.js', 'sentry-vendor'],
  ['/repo/node_modules/@codemirror/view/dist/index.js', 'codemirror-vendor'],
  ['/repo/node_modules/prettier/standalone.js', 'prettier-vendor'],
  ['/repo/apps/canvas/src/main.tsx', undefined]
]

for (const [moduleId, expected] of cases) {
  test(`${moduleId} maps to ${String(expected)}`, () => {
    assert.equal(browserShellManualChunks(moduleId), expected)
  })
}

test('browser shell config applies the shared deployment and build policy', () => {
  const previousDeployBase = process.env.TINYTINKERER_DEPLOY_BASE
  const previousSentryToken = process.env.SENTRY_AUTH_TOKEN

  process.env.TINYTINKERER_DEPLOY_BASE = '/preview/'
  delete process.env.SENTRY_AUTH_TOKEN

  try {
    const config = createBrowserShellViteConfig({
      slug: 'canvas',
      buildInfo: { appVersion: '1.2.3', buildHash: 'abc123' },
      plugins: [{ name: 'shell-plugin' }],
      server: { host: 'localhost' },
      sentryVitePlugin: () => {
        throw new Error('Sentry must remain disabled without an auth token')
      }
    })

    assert.equal(config.base, '/preview/canvas/')
    assert.deepEqual(config.define, {
      __APP_VERSION__: '"1.2.3"',
      __BUILD_HASH__: '"abc123"'
    })
    assert.deepEqual(config.plugins, [{ name: 'shell-plugin' }])
    assert.equal(config.build.sourcemap, false)
    assert.equal(config.build.rollupOptions.output.manualChunks, browserShellManualChunks)
  } finally {
    restoreEnvironmentVariable('TINYTINKERER_DEPLOY_BASE', previousDeployBase)
    restoreEnvironmentVariable('SENTRY_AUTH_TOKEN', previousSentryToken)
  }
})

test('browser shell config appends Sentry after app plugins', () => {
  const previousSentryToken = process.env.SENTRY_AUTH_TOKEN
  process.env.SENTRY_AUTH_TOKEN = 'test-token'

  try {
    const config = createBrowserShellViteConfig({
      slug: 'web',
      buildInfo: { appVersion: '1.2.3', buildHash: 'abc123' },
      plugins: [{ name: 'shell-plugin' }],
      server: { host: 'localhost' },
      sentryVitePlugin: (options) => ({ name: 'sentry', options })
    })

    assert.deepEqual(
      config.plugins.map((plugin) => plugin.name),
      ['shell-plugin', 'sentry']
    )
    assert.equal(config.plugins[1].options.authToken, 'test-token')
    assert.equal(config.plugins[1].options.release.name, 'abc123')
    assert.equal(config.build.sourcemap, 'hidden')
  } finally {
    restoreEnvironmentVariable('SENTRY_AUTH_TOKEN', previousSentryToken)
  }
})
