import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { nosticsStrip } from '@nostics/unplugin/strip-transform'
import { nosticsCollector } from '@nostics/unplugin/dev-server-collector'
import { getBuildInfo } from '../../scripts/build-info.mjs'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/widget/` : '/widget/'
const { appVersion, buildHash } = getBuildInfo()

// Source maps are only generated and uploaded when an auth token is present
// (production CI). Local and PR-preview builds emit no maps and skip the plugin.
const sentryEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN)

export default defineConfig(({ command }) => ({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash)
  },
  plugins: [
    react(),
    tailwindcss(),
    // nostics strip transform (developer diagnostics DX layer). Runs in every
    // build so the deployed widget bundle tree-shakes out report-only
    // diagnostics + their dev reporters (the diagnostics module lives in
    // @tinytinkerer/app-browser, shared by every shell). See
    // packages/app/app-browser/src/diagnostics.ts and docs/diagnostics.md.
    nosticsStrip.vite(),
    // Dev-server only: collects diagnostics the browser forwards and appends
    // them to `.nostics.log`. Never part of a production build.
    ...(command === 'serve' ? [nosticsCollector.vite()] : []),
    // Provides the `virtual:pwa-register` module so the shared bootstrap's
    // `registerPwa()` call resolves uniformly across shells. `disable: true`
    // emits no service worker — registerSW resolves to a no-op — so the widget
    // ships no PWA. Whether a shell is installable is purely this build-time
    // choice.
    VitePWA({ disable: true }),
    // Must be last: injects debug IDs and uploads source maps to Sentry, then
    // deletes the .map files so they are never served publicly. The release name
    // must match the runtime release set in
    // packages/app/app-browser/src/telemetry/telemetry.ts (config.buildHash).
    ...(sentryEnabled
      ? [
          sentryVitePlugin({
            org: 'nntin-labs',
            project: 'tinytinkerer-frontend',
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: buildHash, setCommits: { auto: true } },
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] }
          })
        ]
      : [])
  ],
  server: {
    host: 'localhost'
  },
  build: {
    sourcemap: sentryEnabled ? 'hidden' : false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router')
          ) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/zod/')) {
            return 'zod-vendor'
          }
          // Keep the core workspace packages out of the startup entry chunk.
          // They used to fall into a shared chunk naturally (app-core had a
          // second dynamic importer); with LiteLLM as the sole provider that
          // importer is gone, so the split is pinned explicitly.
          if (
            id.includes('packages/app/app-core/') ||
            id.includes('packages/app/agent-core/') ||
            id.includes('packages/shared/contracts/')
          ) {
            return 'app-core'
          }
          if (
            id.includes('node_modules/@sentry/') ||
            id.includes('node_modules/@sentry-internal/')
          ) {
            return 'sentry-vendor'
          }
          if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/codemirror/')) {
            return 'codemirror-vendor'
          }
        }
      }
    }
  }
}))
