import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/canvas/` : '/canvas/'
const { appVersion, buildHash } = getBuildInfo()

// Source maps are only generated and uploaded when an auth token is present
// (production CI). Local and PR-preview builds emit no maps and skip the plugin.
const sentryEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN)

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_HASH__: JSON.stringify(buildHash)
  },
  plugins: [
    react(),
    tailwindcss(),
    // Provides the `virtual:pwa-register` module so the shared bootstrap's
    // `registerPwa()` call resolves uniformly across shells. `disable: true`
    // emits no service worker — the canvas app ships no PWA.
    VitePWA({ disable: true }),
    // Must be last: injects debug IDs and uploads source maps to Sentry, then
    // deletes the .map files so they are never served publicly.
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
          if (id.includes('node_modules/prettier/')) {
            return 'prettier-vendor'
          }
          // Excalidraw is large (~hundreds of kB) and only used by the lazy canvas
          // surface. Pin it (and its render-only transitive deps) to a dedicated
          // vendor chunk so it stays out of the entry/route budgets and is fetched
          // on demand.
          if (
            id.includes('node_modules/@excalidraw/') ||
            id.includes('node_modules/roughjs/') ||
            id.includes('node_modules/points-on-curve/') ||
            id.includes('node_modules/points-on-path/') ||
            id.includes('node_modules/path-data-parser/')
          ) {
            return 'excalidraw-vendor'
          }
        }
      }
    }
  }
})
