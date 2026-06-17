import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { getBuildInfo } from '../../scripts/build-info.mjs'

const deployBase = process.env.TINYTINKERER_DEPLOY_BASE?.replace(/\/+$/, '')
const base = deployBase ? `${deployBase}/mobile/` : '/mobile/'
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
  publicDir: '../../packages/brand/brand-assets/assets/generated',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Registration is handled manually in src/app/register-pwa.ts so we can
      // drive update checks on foreground + on an interval. `null` prevents the
      // plugin from injecting a second, competing registration.
      injectRegister: null,
      registerType: 'autoUpdate',
      manifest: {
        name: 'tinytinkerer',
        short_name: 'tinytinkerer',
        description:
          'Mobile-first TinyTinkerer workspace optimized for quick installs and narrow screens.',
        start_url: './#/',
        scope: './',
        display: 'standalone',
        background_color: '#fffaf5',
        theme_color: '#f6f2ec',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        globIgnores: ['**/assets/mermaid.min-*.js'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      },
      devOptions: {
        enabled: true
      }
    }),
    // Must be last (after VitePWA so the precache manifest reflects the injected
    // chunks): injects debug IDs and uploads source maps to Sentry, then deletes
    // the .map files so they are never served publicly. The release name must
    // match the runtime release set in
    // packages/app-browser/src/telemetry/telemetry.ts (config.buildHash).
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
    host: 'localhost',
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/auth/github/exchange': { target: 'http://localhost:8787', changeOrigin: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true }
    }
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
})
