import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/canvas/` : '/canvas/'
const { appVersion, buildHash } = getBuildInfo()
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
    VitePWA({ disable: true }),
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
  server: { host: 'localhost' },
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
          if (id.includes('node_modules/zod/')) return 'zod-vendor'
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
          if (id.includes('node_modules/prettier/')) return 'prettier-vendor'
        }
      }
    }
  }
})
