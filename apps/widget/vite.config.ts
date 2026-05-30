import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/widget/` : '/widget/'
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
          if (
            id.includes('node_modules/@sentry/') ||
            id.includes('node_modules/@sentry-internal/')
          ) {
            return 'sentry-vendor'
          }
          if (
            id.includes('node_modules/@codemirror/') ||
            id.includes('node_modules/codemirror/')
          ) {
            return 'codemirror-vendor'
          }
        }
      }
    }
  }
})
